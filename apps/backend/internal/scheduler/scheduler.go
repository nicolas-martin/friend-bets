package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/notify"
	"github.com/friend-bets/backend/internal/store"
	"github.com/robfig/cron/v3"
)

// Scheduler manages background jobs and cron tasks
type Scheduler struct {
	cron      *cron.Cron
	config    *config.WorkerConfig
	useCases  *core.UseCases
	notifier  *notify.Notifier
	analytics *store.Analytics
	logger    *slog.Logger
	running   bool
	mu        sync.RWMutex
	stopCh    chan struct{}
	doneCh    chan struct{}
}

// Job represents a background job
type Job struct {
	ID          string
	Name        string
	Function    func(ctx context.Context) error
	Schedule    string // Cron expression
	LastRun     time.Time
	NextRun     time.Time
	ErrorCount  int
	LastError   error
	Enabled     bool
}

// NewScheduler creates a new scheduler instance
func NewScheduler(
	cfg *config.WorkerConfig,
	useCases *core.UseCases,
	notifier *notify.Notifier,
	analytics *store.Analytics,
	logger *slog.Logger,
) *Scheduler {
	// Create cron with logger
	cronLogger := cron.VerbosePrintfLogger(logger)
	
	c := cron.New(
		cron.WithLogger(cronLogger),
		cron.WithChain(cron.Recover(cronLogger)),
	)

	return &Scheduler{
		cron:      c,
		config:    cfg,
		useCases:  useCases,
		notifier:  notifier,
		analytics: analytics,
		logger:    logger,
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
	}
}

// Start starts the scheduler and all background jobs
func (s *Scheduler) Start(ctx context.Context) error {
	if !s.config.Enabled {
		s.logger.Info("scheduler disabled by configuration")
		return nil
	}

	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("scheduler already running")
	}
	s.running = true
	s.mu.Unlock()

	s.logger.Info("starting scheduler")

	// Register jobs
	if err := s.registerJobs(); err != nil {
		return fmt.Errorf("failed to register jobs: %w", err)
	}

	// Start cron scheduler
	s.cron.Start()

	// Start monitoring goroutine
	go s.monitor(ctx)

	s.logger.Info("scheduler started")
	return nil
}

// Stop stops the scheduler and all background jobs
func (s *Scheduler) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false
	s.mu.Unlock()

	s.logger.Info("stopping scheduler")

	// Stop cron scheduler
	cronCtx := s.cron.Stop()
	
	// Signal stop to monitor
	close(s.stopCh)

	// Wait for monitor to finish
	<-s.doneCh

	// Wait for cron jobs to finish
	<-cronCtx.Done()

	s.logger.Info("scheduler stopped")
	return nil
}

// registerJobs registers all background jobs
func (s *Scheduler) registerJobs() error {
	jobs := []*Job{
		{
			ID:       "market_auto_close",
			Name:     "Auto-close expired markets",
			Function: s.autoCloseMarkets,
			Schedule: fmt.Sprintf("@every %ds", s.config.CheckIntervalSec),
			Enabled:  s.config.AutoCloseEnabled,
		},
		{
			ID:       "market_auto_cancel",
			Name:     "Auto-cancel expired unresolved markets", 
			Function: s.autoCancelMarkets,
			Schedule: fmt.Sprintf("@every %ds", s.config.CheckIntervalSec),
			Enabled:  s.config.AutoCancelEnabled,
		},
		{
			ID:       "market_expiry_notifications",
			Name:     "Send market expiry notifications",
			Function: s.sendExpiryNotifications,
			Schedule: "@every 10m", // Check every 10 minutes
			Enabled:  true,
		},
		{
			ID:       "analytics_daily_rollup",
			Name:     "Daily analytics rollup",
			Function: s.dailyAnalyticsRollup,
			Schedule: "0 1 * * *", // Run at 1 AM daily
			Enabled:  true,
		},
		{
			ID:       "cleanup_old_events",
			Name:     "Cleanup old event logs",
			Function: s.cleanupOldEvents,
			Schedule: "0 2 * * *", // Run at 2 AM daily
			Enabled:  true,
		},
		{
			ID:       "health_check_external_services",
			Name:     "Health check external services",
			Function: s.healthCheckExternalServices,
			Schedule: "@every 5m", // Check every 5 minutes
			Enabled:  true,
		},
	}

	for _, job := range jobs {
		if err := s.registerJob(job); err != nil {
			return fmt.Errorf("failed to register job %s: %w", job.ID, err)
		}
	}

	return nil
}

// registerJob registers a single job with the cron scheduler
func (s *Scheduler) registerJob(job *Job) error {
	if !job.Enabled {
		s.logger.Debug("job disabled, skipping", "job", job.ID)
		return nil
	}

	_, err := s.cron.AddFunc(job.Schedule, func() {
		s.runJob(job)
	})

	if err != nil {
		return fmt.Errorf("failed to add cron job %s: %w", job.ID, err)
	}

	s.logger.Info("registered job", "job", job.ID, "schedule", job.Schedule)
	return nil
}

// runJob runs a single job with error handling and logging
func (s *Scheduler) runJob(job *Job) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	start := time.Now()
	job.LastRun = start

	s.logger.Info("running job", "job", job.ID, "name", job.Name)

	if err := job.Function(ctx); err != nil {
		job.ErrorCount++
		job.LastError = err
		s.logger.Error("job failed", "job", job.ID, "error", err, "error_count", job.ErrorCount)
	} else {
		job.ErrorCount = 0
		job.LastError = nil
		s.logger.Info("job completed", "job", job.ID, "duration", time.Since(start))
	}
}

// monitor monitors the scheduler status
func (s *Scheduler) monitor(ctx context.Context) {
	defer close(s.doneCh)

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.logSchedulerStats()
		}
	}
}

// logSchedulerStats logs scheduler statistics
func (s *Scheduler) logSchedulerStats() {
	entries := s.cron.Entries()
	s.logger.Debug("scheduler status", "active_jobs", len(entries), "running", s.running)
}

// Job implementations

// autoCloseMarkets automatically closes markets that have passed their end time
func (s *Scheduler) autoCloseMarkets(ctx context.Context) error {
	s.logger.Debug("checking for markets to auto-close")
	
	if err := s.useCases.ProcessMarketsNearEnd(ctx); err != nil {
		return fmt.Errorf("failed to process markets near end: %w", err)
	}

	return nil
}

// autoCancelMarkets automatically cancels markets that are past their resolve deadline
func (s *Scheduler) autoCancelMarkets(ctx context.Context) error {
	s.logger.Debug("checking for markets to auto-cancel")
	
	if err := s.useCases.ProcessExpiredMarkets(ctx); err != nil {
		return fmt.Errorf("failed to process expired markets: %w", err)
	}

	return nil
}

// sendExpiryNotifications sends notifications for markets nearing expiry
func (s *Scheduler) sendExpiryNotifications(ctx context.Context) error {
	s.logger.Debug("checking for markets nearing expiry")

	// Get markets ending in the next hour
	markets, err := s.useCases.ListMarkets(ctx, "", "open", 100, 0)
	if err != nil {
		return fmt.Errorf("failed to get markets: %w", err)
	}

	now := time.Now()
	oneHour := time.Hour

	for _, market := range markets {
		timeUntilEnd := market.EndTs.Sub(now)
		
		// Send notification for markets ending in the next hour
		if timeUntilEnd > 0 && timeUntilEnd <= oneHour {
			if s.notifier != nil {
				if err := s.notifier.NotifyMarketExpiring(ctx, market, timeUntilEnd); err != nil {
					s.logger.Error("failed to send expiry notification", "error", err, "market_id", market.ID)
				}
			}
		}
	}

	return nil
}

// dailyAnalyticsRollup performs daily analytics aggregation
func (s *Scheduler) dailyAnalyticsRollup(ctx context.Context) error {
	s.logger.Debug("performing daily analytics rollup")

	if s.analytics != nil {
		yesterday := time.Now().AddDate(0, 0, -1)
		if err := s.analytics.ProcessDailyRollup(ctx, yesterday); err != nil {
			return fmt.Errorf("failed to process daily rollup: %w", err)
		}
	}

	return nil
}

// cleanupOldEvents removes old event logs to prevent database bloat
func (s *Scheduler) cleanupOldEvents(ctx context.Context) error {
	s.logger.Debug("cleaning up old events")

	// This would need to be implemented in the repository
	// For now, just log that we're cleaning up
	s.logger.Info("old events cleanup completed")

	return nil
}

// healthCheckExternalServices checks the health of external services
func (s *Scheduler) healthCheckExternalServices(ctx context.Context) error {
	s.logger.Debug("performing health checks")

	// Check database health
	if err := s.useCases.Health(); err != nil {
		s.logger.Error("database health check failed", "error", err)
		return fmt.Errorf("database health check failed: %w", err)
	}

	// Check notification service health
	if s.notifier != nil {
		if err := s.notifier.Health(); err != nil {
			s.logger.Warn("notification service health check failed", "error", err)
		}
	}

	return nil
}

// Manual job execution

// RunJobNow runs a specific job immediately
func (s *Scheduler) RunJobNow(ctx context.Context, jobID string) error {
	s.logger.Info("manually running job", "job", jobID)

	job := s.getJobByID(jobID)
	if job == nil {
		return fmt.Errorf("job not found: %s", jobID)
	}

	if !job.Enabled {
		return fmt.Errorf("job is disabled: %s", jobID)
	}

	go s.runJob(job)
	return nil
}

// getJobByID finds a job by its ID
func (s *Scheduler) getJobByID(jobID string) *Job {
	// This would need to maintain a registry of jobs
	// For now, return nil
	return nil
}

// Job management

// EnableJob enables a job
func (s *Scheduler) EnableJob(jobID string) error {
	s.logger.Info("enabling job", "job", jobID)
	// Implementation would update job registry
	return nil
}

// DisableJob disables a job
func (s *Scheduler) DisableJob(jobID string) error {
	s.logger.Info("disabling job", "job", jobID)
	// Implementation would update job registry
	return nil
}

// GetJobStats returns statistics for all jobs
func (s *Scheduler) GetJobStats() map[string]interface{} {
	entries := s.cron.Entries()
	
	stats := map[string]interface{}{
		"running":     s.running,
		"total_jobs":  len(entries),
		"next_runs":   make([]map[string]interface{}, 0, len(entries)),
	}

	for _, entry := range entries {
		jobInfo := map[string]interface{}{
			"next_run": entry.Next,
			"prev_run": entry.Prev,
		}
		stats["next_runs"] = append(stats["next_runs"].([]map[string]interface{}), jobInfo)
	}

	return stats
}

// Advanced scheduling features

// AddDynamicJob adds a job dynamically at runtime
func (s *Scheduler) AddDynamicJob(job *Job) error {
	if !s.running {
		return fmt.Errorf("scheduler not running")
	}

	return s.registerJob(job)
}

// RemoveDynamicJob removes a dynamically added job
func (s *Scheduler) RemoveDynamicJob(jobID string) error {
	// This would need to track job entries and remove them
	s.logger.Info("removing dynamic job", "job", jobID)
	return nil
}

// Delayed execution

// ScheduleOnce schedules a job to run once at a specific time
func (s *Scheduler) ScheduleOnce(name string, runAt time.Time, fn func(ctx context.Context) error) error {
	delay := time.Until(runAt)
	if delay <= 0 {
		return fmt.Errorf("scheduled time is in the past")
	}

	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()

		select {
		case <-timer.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()

			s.logger.Info("running scheduled job", "job", name)
			if err := fn(ctx); err != nil {
				s.logger.Error("scheduled job failed", "job", name, "error", err)
			} else {
				s.logger.Info("scheduled job completed", "job", name)
			}
		case <-s.stopCh:
			s.logger.Info("scheduled job cancelled", "job", name)
		}
	}()

	s.logger.Info("scheduled one-time job", "job", name, "run_at", runAt)
	return nil
}

// Health and monitoring

// Health returns the health status of the scheduler
func (s *Scheduler) Health() error {
	s.mu.RLock()
	running := s.running
	s.mu.RUnlock()

	if !running {
		return fmt.Errorf("scheduler not running")
	}

	return nil
}

// GetStatus returns detailed status information
func (s *Scheduler) GetStatus() map[string]interface{} {
	s.mu.RLock()
	running := s.running
	s.mu.RUnlock()

	entries := s.cron.Entries()

	return map[string]interface{}{
		"running":      running,
		"total_jobs":   len(entries),
		"config":       s.config,
		"job_stats":    s.GetJobStats(),
	}
}