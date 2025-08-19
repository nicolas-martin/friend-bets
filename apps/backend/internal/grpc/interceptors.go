package grpc

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/friend-bets/backend/internal/rate"
)

// LoggingInterceptor logs incoming requests
type LoggingInterceptor struct {
	logger *slog.Logger
}

// NewLoggingInterceptor creates a new logging interceptor
func NewLoggingInterceptor(logger *slog.Logger) connect.UnaryInterceptorFunc {
	interceptor := &LoggingInterceptor{logger: logger}
	return interceptor.Intercept
}

// Intercept implements the logging interceptor
func (i *LoggingInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		start := time.Now()
		
		// Extract client IP
		clientIP := "unknown"
		if peer := req.Peer(); peer != nil {
			clientIP = peer.Addr
		}

		// Extract user agent
		userAgent := ""
		if req.Header() != nil {
			userAgent = req.Header().Get("User-Agent")
		}

		i.logger.Info("grpc request started",
			"method", req.Spec().Procedure,
			"client_ip", clientIP,
			"user_agent", userAgent,
		)

		// Call next handler
		resp, err := next(ctx, req)
		
		// Log completion
		duration := time.Since(start)
		if err != nil {
			i.logger.Error("grpc request failed",
				"method", req.Spec().Procedure,
				"client_ip", clientIP,
				"duration_ms", duration.Milliseconds(),
				"error", err,
			)
		} else {
			i.logger.Info("grpc request completed",
				"method", req.Spec().Procedure,
				"client_ip", clientIP,
				"duration_ms", duration.Milliseconds(),
			)
		}

		return resp, err
	})
}

// RateLimitInterceptor implements rate limiting
type RateLimitInterceptor struct {
	rateLimiter *rate.Limiter
}

// NewRateLimitInterceptor creates a new rate limiting interceptor
func NewRateLimitInterceptor(rateLimiter *rate.Limiter) connect.UnaryInterceptorFunc {
	interceptor := &RateLimitInterceptor{rateLimiter: rateLimiter}
	return interceptor.Intercept
}

// Intercept implements the rate limiting interceptor
func (i *RateLimitInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Extract client IP
		clientIP := "unknown"
		if peer := req.Peer(); peer != nil {
			clientIP = peer.Addr
		}

		// Extract user ID from context or headers
		userID := i.extractUserID(ctx, req)

		// Determine rate limit key and action
		method := req.Spec().Procedure
		action := i.methodToAction(method)

		// Check rate limits
		if err := i.checkRateLimits(ctx, clientIP, userID, action); err != nil {
			return nil, connect.NewError(connect.CodeResourceExhausted, err)
		}

		return next(ctx, req)
	})
}

// extractUserID extracts user ID from context or headers
func (i *RateLimitInterceptor) extractUserID(ctx context.Context, req connect.AnyRequest) string {
	// Try to get from context first (set by auth interceptor)
	if userID := ctx.Value("user_id"); userID != nil {
		if uid, ok := userID.(string); ok {
			return uid
		}
	}

	// Try to extract from headers
	if req.Header() != nil {
		if auth := req.Header().Get("Authorization"); auth != "" {
			// Simple extraction - in practice you'd verify the token
			if strings.HasPrefix(auth, "Bearer ") {
				return auth[7:] // Remove "Bearer " prefix
			}
		}
	}

	return ""
}

// methodToAction converts gRPC method to rate limit action
func (i *RateLimitInterceptor) methodToAction(method string) string {
	switch {
	case strings.Contains(method, "CreateMarket"):
		return "create_market"
	case strings.Contains(method, "PlaceBet"):
		return "place_bet"
	default:
		return "general"
	}
}

// checkRateLimits checks various rate limits
func (i *RateLimitInterceptor) checkRateLimits(ctx context.Context, clientIP, userID, action string) error {
	// Check IP-based rate limit
	ipKey := fmt.Sprintf("ip:%s", clientIP)
	if !i.rateLimiter.Allow(ctx, ipKey, "general", time.Minute, 100) {
		return fmt.Errorf("IP rate limit exceeded")
	}

	// Check user-based rate limits if user ID is available
	if userID != "" {
		userKey := fmt.Sprintf("user:%s", userID)
		
		switch action {
		case "create_market":
			if !i.rateLimiter.Allow(ctx, userKey, action, time.Hour, 10) {
				return fmt.Errorf("create market rate limit exceeded")
			}
		case "place_bet":
			if !i.rateLimiter.Allow(ctx, userKey, action, time.Minute, 20) {
				return fmt.Errorf("place bet rate limit exceeded")
			}
		}
	}

	return nil
}

// AuthInterceptor handles authentication
type AuthInterceptor struct {
	logger *slog.Logger
}

// NewAuthInterceptor creates a new auth interceptor
func NewAuthInterceptor(logger *slog.Logger) connect.UnaryInterceptorFunc {
	interceptor := &AuthInterceptor{logger: logger}
	return interceptor.Intercept
}

// Intercept implements the auth interceptor
func (i *AuthInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Extract auth token
		var token string
		if req.Header() != nil {
			auth := req.Header().Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = auth[7:]
			}
		}

		// Determine if auth is required for this method
		method := req.Spec().Procedure
		if i.requiresAuth(method) {
			if token == "" {
				return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("authentication required"))
			}

			// Validate token and extract user info
			userID, err := i.validateToken(ctx, token)
			if err != nil {
				return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid token: %w", err))
			}

			// Add user info to context
			ctx = context.WithValue(ctx, "user_id", userID)
			ctx = context.WithValue(ctx, "auth_token", token)
		}

		return next(ctx, req)
	})
}

// requiresAuth determines if a method requires authentication
func (i *AuthInterceptor) requiresAuth(method string) bool {
	// Most methods require auth, except for listing markets and watching events
	publicMethods := []string{
		"/bets.v1.BetsService/ListMarkets",
		"/bets.v1.BetsService/WatchEvents",
		"/grpc.health.v1.Health/Check",
	}

	for _, publicMethod := range publicMethods {
		if method == publicMethod {
			return false
		}
	}

	return true
}

// validateToken validates an auth token and returns user ID
func (i *AuthInterceptor) validateToken(ctx context.Context, token string) (string, error) {
	// In a real implementation, this would:
	// 1. Verify the token signature
	// 2. Check token expiration
	// 3. Validate against a user database
	// 4. Handle different token types (JWT, API key, etc.)
	
	// For now, we'll do a simple validation
	if len(token) < 10 {
		return "", fmt.Errorf("token too short")
	}

	// In Solana context, the "token" might be a public key
	// We could validate it's a valid base58 public key
	if len(token) == 44 || len(token) == 43 {
		// Looks like a Solana public key
		return token, nil
	}

	// For development, accept any non-empty token
	return token, nil
}

// Recovery interceptor to handle panics
type RecoveryInterceptor struct {
	logger *slog.Logger
}

// NewRecoveryInterceptor creates a new recovery interceptor
func NewRecoveryInterceptor(logger *slog.Logger) connect.UnaryInterceptorFunc {
	interceptor := &RecoveryInterceptor{logger: logger}
	return interceptor.Intercept
}

// Intercept implements the recovery interceptor
func (i *RecoveryInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (resp connect.AnyResponse, err error) {
		defer func() {
			if r := recover(); r != nil {
				i.logger.Error("panic in grpc handler",
					"method", req.Spec().Procedure,
					"panic", r,
				)
				err = connect.NewError(connect.CodeInternal, fmt.Errorf("internal server error"))
			}
		}()

		return next(ctx, req)
	})
}

// Validation interceptor for request validation
type ValidationInterceptor struct {
	logger *slog.Logger
}

// NewValidationInterceptor creates a new validation interceptor
func NewValidationInterceptor(logger *slog.Logger) connect.UnaryInterceptorFunc {
	interceptor := &ValidationInterceptor{logger: logger}
	return interceptor.Intercept
}

// Intercept implements the validation interceptor
func (i *ValidationInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Basic request validation
		if req.Any() == nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("request body is required"))
		}

		// Method-specific validation could be added here
		method := req.Spec().Procedure
		if err := i.validateMethodSpecificRequirements(method, req); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}

		return next(ctx, req)
	})
}

// validateMethodSpecificRequirements validates method-specific requirements
func (i *ValidationInterceptor) validateMethodSpecificRequirements(method string, req connect.AnyRequest) error {
	// Add method-specific validation logic here
	// For now, just basic checks
	return nil
}

// Timeout interceptor to enforce request timeouts
type TimeoutInterceptor struct {
	defaultTimeout time.Duration
	logger         *slog.Logger
}

// NewTimeoutInterceptor creates a new timeout interceptor
func NewTimeoutInterceptor(defaultTimeout time.Duration, logger *slog.Logger) connect.UnaryInterceptorFunc {
	interceptor := &TimeoutInterceptor{
		defaultTimeout: defaultTimeout,
		logger:         logger,
	}
	return interceptor.Intercept
}

// Intercept implements the timeout interceptor
func (i *TimeoutInterceptor) Intercept(next connect.UnaryFunc) connect.UnaryFunc {
	return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Check if context already has a timeout
		if _, hasDeadline := ctx.Deadline(); !hasDeadline {
			// Add default timeout
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, i.defaultTimeout)
			defer cancel()
		}

		return next(ctx, req)
	})
}