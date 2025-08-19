package rate

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/store"
)

// Limiter provides rate limiting functionality using token bucket algorithm
type Limiter struct {
	config  *config.RateConfig
	repo    *store.Repository
	buckets map[string]*TokenBucket
	mu      sync.RWMutex
	logger  *slog.Logger
}

// TokenBucket represents a token bucket for rate limiting
type TokenBucket struct {
	capacity     int
	tokens       int
	refillRate   time.Duration
	lastRefill   time.Time
	mu           sync.Mutex
}

// NewLimiter creates a new rate limiter
func NewLimiter(cfg *config.RateConfig, repo *store.Repository, logger *slog.Logger) *Limiter {
	limiter := &Limiter{
		config:  cfg,
		repo:    repo,
		buckets: make(map[string]*TokenBucket),
		logger:  logger,
	}

	// Start cleanup routine
	go limiter.cleanupRoutine()

	return limiter
}

// Allow checks if an action is allowed under the rate limit
func (l *Limiter) Allow(ctx context.Context, key, action string, window time.Duration, limit int) bool {
	// Get or create token bucket for this key+action
	bucketKey := fmt.Sprintf("%s:%s", key, action)
	bucket := l.getOrCreateBucket(bucketKey, limit, window)

	// Check if tokens are available
	if !bucket.consume() {
		l.logger.Debug("rate limit exceeded", "key", key, "action", action, "limit", limit)
		return false
	}

	// Also track in database for persistence across restarts
	go func() {
		if _, err := l.repo.IncrementRateCounter(bucketKey, window); err != nil {
			l.logger.Error("failed to increment rate counter in database", "error", err)
		}
	}()

	return true
}

// AllowN checks if N actions are allowed under the rate limit
func (l *Limiter) AllowN(ctx context.Context, key, action string, window time.Duration, limit int, n int) bool {
	bucketKey := fmt.Sprintf("%s:%s", key, action)
	bucket := l.getOrCreateBucket(bucketKey, limit, window)

	return bucket.consumeN(n)
}

// Reset resets the rate limit for a specific key and action
func (l *Limiter) Reset(ctx context.Context, key, action string) error {
	bucketKey := fmt.Sprintf("%s:%s", key, action)
	
	l.mu.Lock()
	if bucket, exists := l.buckets[bucketKey]; exists {
		bucket.reset()
	}
	l.mu.Unlock()

	return nil
}

// GetUsage returns the current usage for a key and action
func (l *Limiter) GetUsage(ctx context.Context, key, action string) (int, int, error) {
	bucketKey := fmt.Sprintf("%s:%s", key, action)
	
	l.mu.RLock()
	bucket, exists := l.buckets[bucketKey]
	l.mu.RUnlock()

	if !exists {
		return 0, l.getLimitForAction(action), nil
	}

	bucket.mu.Lock()
	used := bucket.capacity - bucket.tokens
	capacity := bucket.capacity
	bucket.mu.Unlock()

	return used, capacity, nil
}

// getOrCreateBucket gets an existing token bucket or creates a new one
func (l *Limiter) getOrCreateBucket(key string, capacity int, refillPeriod time.Duration) *TokenBucket {
	l.mu.RLock()
	bucket, exists := l.buckets[key]
	l.mu.RUnlock()

	if exists {
		return bucket
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	// Double-check after acquiring write lock
	if bucket, exists := l.buckets[key]; exists {
		return bucket
	}

	// Create new bucket
	bucket = &TokenBucket{
		capacity:   capacity,
		tokens:     capacity,
		refillRate: refillPeriod / time.Duration(capacity),
		lastRefill: time.Now(),
	}

	l.buckets[key] = bucket
	return bucket
}

// getLimitForAction gets the default limit for an action
func (l *Limiter) getLimitForAction(action string) int {
	switch action {
	case "create_market":
		return l.config.CreateMarketPerHour
	case "place_bet":
		return l.config.PlaceBetPerMinute
	case "general":
		return l.config.IPRatePerMinute
	default:
		return 100 // Default limit
	}
}

// cleanupRoutine periodically cleans up old token buckets
func (l *Limiter) cleanupRoutine() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			l.cleanup()
		}
	}
}

// cleanup removes old token buckets that haven't been used recently
func (l *Limiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := time.Now().Add(-10 * time.Minute)
	
	for key, bucket := range l.buckets {
		bucket.mu.Lock()
		lastUsed := bucket.lastRefill
		bucket.mu.Unlock()

		if lastUsed.Before(cutoff) {
			delete(l.buckets, key)
		}
	}

	// Also cleanup database counters
	go func() {
		if err := l.repo.CleanupExpiredRateCounters(); err != nil {
			l.logger.Error("failed to cleanup expired rate counters", "error", err)
		}
	}()
}

// Token bucket methods

// consume attempts to consume one token from the bucket
func (tb *TokenBucket) consume() bool {
	return tb.consumeN(1)
}

// consumeN attempts to consume N tokens from the bucket
func (tb *TokenBucket) consumeN(n int) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.refill()

	if tb.tokens >= n {
		tb.tokens -= n
		return true
	}

	return false
}

// refill adds tokens to the bucket based on elapsed time
func (tb *TokenBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(tb.lastRefill)
	
	tokensToAdd := int(elapsed / tb.refillRate)
	if tokensToAdd > 0 {
		tb.tokens += tokensToAdd
		if tb.tokens > tb.capacity {
			tb.tokens = tb.capacity
		}
		tb.lastRefill = now
	}
}

// reset resets the bucket to full capacity
func (tb *TokenBucket) reset() {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.tokens = tb.capacity
	tb.lastRefill = time.Now()
}

// Advanced rate limiting strategies

// CheckBurstLimit checks if a burst of requests exceeds the allowed limit
func (l *Limiter) CheckBurstLimit(ctx context.Context, key string, burstWindow time.Duration, burstLimit int) bool {
	// Track requests in a sliding window
	windowKey := fmt.Sprintf("burst:%s", key)
	
	// Use token bucket with burst capacity
	bucket := l.getOrCreateBucket(windowKey, burstLimit, burstWindow)
	return bucket.consume()
}

// CheckGlobalLimit checks against a global rate limit
func (l *Limiter) CheckGlobalLimit(ctx context.Context, action string, globalLimit int, window time.Duration) bool {
	globalKey := fmt.Sprintf("global:%s", action)
	bucket := l.getOrCreateBucket(globalKey, globalLimit, window)
	return bucket.consume()
}

// Adaptive rate limiting based on system load
type LoadBasedLimiter struct {
	*Limiter
	baseLimit    int
	loadFactor   func() float64 // Function to get current system load (0.0 - 1.0)
}

// NewLoadBasedLimiter creates a rate limiter that adapts to system load
func NewLoadBasedLimiter(cfg *config.RateConfig, repo *store.Repository, logger *slog.Logger, loadFactor func() float64) *LoadBasedLimiter {
	return &LoadBasedLimiter{
		Limiter:    NewLimiter(cfg, repo, logger),
		baseLimit:  cfg.IPRatePerMinute,
		loadFactor: loadFactor,
	}
}

// AllowAdaptive allows requests based on current system load
func (lbl *LoadBasedLimiter) AllowAdaptive(ctx context.Context, key, action string, window time.Duration) bool {
	load := lbl.loadFactor()
	
	// Reduce limit based on load (higher load = lower limit)
	adaptiveLimit := int(float64(lbl.baseLimit) * (1.0 - load*0.5))
	if adaptiveLimit < 1 {
		adaptiveLimit = 1
	}

	return lbl.Allow(ctx, key, action, window, adaptiveLimit)
}

// Distributed rate limiting (for multiple server instances)
type DistributedLimiter struct {
	*Limiter
	nodeID string
}

// NewDistributedLimiter creates a distributed rate limiter
func NewDistributedLimiter(cfg *config.RateConfig, repo *store.Repository, logger *slog.Logger, nodeID string) *DistributedLimiter {
	return &DistributedLimiter{
		Limiter: NewLimiter(cfg, repo, logger),
		nodeID:  nodeID,
	}
}

// AllowDistributed checks rate limits across all nodes
func (dl *DistributedLimiter) AllowDistributed(ctx context.Context, key, action string, window time.Duration, limit int) bool {
	// Use database-based counting for distributed rate limiting
	distributedKey := fmt.Sprintf("dist:%s:%s", key, action)
	
	count, err := dl.repo.IncrementRateCounter(distributedKey, window)
	if err != nil {
		dl.logger.Error("failed to check distributed rate limit", "error", err)
		// Fall back to local rate limiting
		return dl.Allow(ctx, key, action, window, limit)
	}

	if count > limit {
		dl.logger.Debug("distributed rate limit exceeded", "key", key, "action", action, "count", count, "limit", limit)
		return false
	}

	return true
}

// Rate limiting middleware helpers

// RateLimitInfo contains information about rate limiting status
type RateLimitInfo struct {
	Allowed       bool
	Limit         int
	Remaining     int
	ResetTime     time.Time
	RetryAfter    time.Duration
}

// CheckWithInfo checks rate limit and returns detailed information
func (l *Limiter) CheckWithInfo(ctx context.Context, key, action string, window time.Duration, limit int) *RateLimitInfo {
	bucketKey := fmt.Sprintf("%s:%s", key, action)
	bucket := l.getOrCreateBucket(bucketKey, limit, window)

	bucket.mu.Lock()
	bucket.refill()
	
	info := &RateLimitInfo{
		Allowed:   bucket.tokens > 0,
		Limit:     bucket.capacity,
		Remaining: bucket.tokens,
		ResetTime: bucket.lastRefill.Add(window),
	}

	if bucket.tokens > 0 {
		bucket.tokens--
	} else {
		// Calculate retry after duration
		info.RetryAfter = bucket.refillRate
	}
	
	bucket.mu.Unlock()

	return info
}

// Metrics and monitoring

// GetLimiterStats returns statistics about the rate limiter
func (l *Limiter) GetLimiterStats() map[string]interface{} {
	l.mu.RLock()
	defer l.mu.RUnlock()

	stats := map[string]interface{}{
		"total_buckets": len(l.buckets),
		"buckets":       make(map[string]interface{}),
	}

	for key, bucket := range l.buckets {
		bucket.mu.Lock()
		bucketStats := map[string]interface{}{
			"capacity":    bucket.capacity,
			"tokens":      bucket.tokens,
			"refill_rate": bucket.refillRate.String(),
			"last_refill": bucket.lastRefill,
		}
		bucket.mu.Unlock()
		
		stats["buckets"].(map[string]interface{})[key] = bucketStats
	}

	return stats
}

// Health check
func (l *Limiter) Health() error {
	// Check if we can access the database
	return l.repo.Health()
}