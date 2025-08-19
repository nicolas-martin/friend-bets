package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/notify"
	"github.com/friend-bets/backend/internal/scheduler"
	"github.com/friend-bets/backend/internal/solana"
	"github.com/friend-bets/backend/internal/store"
)

const (
	serviceName = "friend-bets-worker"
	version     = "1.0.0"
)

func main() {
	// Parse command line flags
	var (
		configFile = flag.String("config", "", "Path to configuration file")
		logLevel   = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
		showVer    = flag.Bool("version", false, "Show version information")
		runOnce    = flag.Bool("run-once", false, "Run jobs once and exit (useful for testing)")
	)
	flag.Parse()

	if *showVer {
		fmt.Printf("%s version %s\n", serviceName, version)
		os.Exit(0)
	}

	// Load configuration first
	cfg, err := config.Load(*configFile)
	if err != nil {
		fmt.Printf("Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	// Initialize logger with config
	logger := setupLogger(*logLevel, cfg)
	logger.Info("starting worker service", "service", serviceName, "version", version)

	logger.Info("configuration loaded", "config_file", *configFile)

	// Check if worker is enabled
	if !cfg.Worker.Enabled {
		logger.Info("worker service is disabled in configuration")
		os.Exit(0)
	}

	// Create context that cancels on interrupt
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Initialize services
	services, err := initializeServices(ctx, cfg, logger)
	if err != nil {
		logger.Error("failed to initialize services", "error", err)
		os.Exit(1)
	}

	// Start services
	if err := startServices(ctx, services, logger, *runOnce); err != nil {
		logger.Error("failed to start services", "error", err)
		os.Exit(1)
	}

	logger.Info("worker service started successfully")

	// Wait for shutdown signal or completion (in run-once mode)
	if *runOnce {
		logger.Info("run-once mode completed, exiting")
	} else {
		<-sigCh
		logger.Info("received shutdown signal, initiating graceful shutdown")
	}

	// Cancel context to signal shutdown
	cancel()

	// Stop services with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := stopServices(shutdownCtx, services, logger); err != nil {
		logger.Error("error during shutdown", "error", err)
		os.Exit(1)
	}

	logger.Info("worker service stopped successfully")
}

// WorkerServices holds all worker services
type WorkerServices struct {
	DB           *store.DB
	Repository   *store.Repository
	Analytics    *store.Analytics
	UseCases     *core.UseCases
	SolanaClient *solana.AnchorClient
	EventIndexer *solana.EventIndexer
	Notifier     *notify.Notifier
	Scheduler    *scheduler.Scheduler
}

// initializeServices initializes all worker services
func initializeServices(ctx context.Context, cfg *config.Config, logger *slog.Logger) (*WorkerServices, error) {
	services := &WorkerServices{}

	// Initialize database
	logger.Info("initializing database connection")
	db, err := store.NewDB(cfg.Database.URL, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}
	services.DB = db

	// Run database migrations
	logger.Info("running database migrations")
	if err := store.AutoMigrate(db.DB); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	// Initialize repository
	services.Repository = store.NewRepository(db)

	// Initialize analytics
	services.Analytics = store.NewAnalytics(services.Repository, logger)

	// Initialize use cases
	services.UseCases = core.NewUseCases(services.Repository, cfg, logger)

	// Initialize Solana client
	logger.Info("initializing Solana client")
	solanaClient, err := solana.NewAnchorClient(&cfg.Solana, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Solana client: %w", err)
	}
	services.SolanaClient = solanaClient

	// Initialize event indexer
	if cfg.Worker.IndexerEnabled {
		logger.Info("initializing event indexer")
		eventIndexer, err := solana.NewEventIndexer(&cfg.Solana, services.Repository, services.UseCases, logger)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize event indexer: %w", err)
		}
		services.EventIndexer = eventIndexer
	}

	// Initialize notifier
	logger.Info("initializing notification service")
	services.Notifier = notify.NewNotifier(&cfg.Notify, services.Repository, logger)

	// Initialize scheduler
	logger.Info("initializing scheduler")
	services.Scheduler = scheduler.NewScheduler(
		&cfg.Worker,
		services.UseCases,
		services.Notifier,
		services.Analytics,
		logger,
	)

	logger.Info("all worker services initialized successfully")
	return services, nil
}

// startServices starts all worker services
func startServices(ctx context.Context, services *WorkerServices, logger *slog.Logger, runOnce bool) error {
	var wg sync.WaitGroup
	errCh := make(chan error, 3)

	// Start event indexer if enabled
	if services.EventIndexer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.Info("starting event indexer")
			if err := services.EventIndexer.Start(ctx); err != nil {
				select {
				case errCh <- fmt.Errorf("event indexer error: %w", err):
				default:
				}
			}
		}()
	}

	// Start scheduler
	if !runOnce {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.Info("starting scheduler")
			if err := services.Scheduler.Start(ctx); err != nil {
				select {
				case errCh <- fmt.Errorf("scheduler error: %w", err):
				default:
				}
			}
		}()
	} else {
		// In run-once mode, execute critical jobs manually
		if err := runCriticalJobsOnce(ctx, services, logger); err != nil {
			return fmt.Errorf("failed to run critical jobs: %w", err)
		}
	}

	// Start health monitoring
	wg.Add(1)
	go func() {
		defer wg.Done()
		monitorHealth(ctx, services, logger)
	}()

	// Wait a moment for services to start
	time.Sleep(100 * time.Millisecond)

	// Check for immediate startup errors
	select {
	case err := <-errCh:
		return err
	default:
	}

	logger.Info("all worker services started")
	return nil
}

// runCriticalJobsOnce runs critical jobs once and exits (for cron or testing)
func runCriticalJobsOnce(ctx context.Context, services *WorkerServices, logger *slog.Logger) error {
	logger.Info("running critical jobs in run-once mode")

	// Process markets near end
	if err := services.UseCases.ProcessMarketsNearEnd(ctx); err != nil {
		logger.Error("failed to process markets near end", "error", err)
		return fmt.Errorf("failed to process markets near end: %w", err)
	}

	// Process expired markets
	if err := services.UseCases.ProcessExpiredMarkets(ctx); err != nil {
		logger.Error("failed to process expired markets", "error", err)
		return fmt.Errorf("failed to process expired markets: %w", err)
	}

	// Process daily analytics rollup
	yesterday := time.Now().AddDate(0, 0, -1)
	if err := services.Analytics.ProcessDailyRollup(ctx, yesterday); err != nil {
		logger.Error("failed to process daily rollup", "error", err)
		return fmt.Errorf("failed to process daily rollup: %w", err)
	}

	logger.Info("critical jobs completed successfully")
	return nil
}

// stopServices stops all worker services
func stopServices(ctx context.Context, services *WorkerServices, logger *slog.Logger) error {
	var wg sync.WaitGroup

	// Stop event indexer
	if services.EventIndexer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.Info("stopping event indexer")
			services.EventIndexer.Stop()
		}()
	}

	// Stop scheduler
	if services.Scheduler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.Info("stopping scheduler")
			if err := services.Scheduler.Stop(); err != nil {
				logger.Error("error stopping scheduler", "error", err)
			}
		}()
	}

	// Wait for all services to stop
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.Info("all worker services stopped")
	case <-ctx.Done():
		logger.Warn("shutdown timeout, some services may not have stopped cleanly")
	}

	// Close database connection
	if services.DB != nil {
		logger.Info("closing database connection")
		if err := services.DB.Close(); err != nil {
			logger.Error("error closing database", "error", err)
			return err
		}
	}

	return nil
}

// monitorHealth periodically checks the health of services
func monitorHealth(ctx context.Context, services *WorkerServices, logger *slog.Logger) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := performHealthCheck(ctx, services); err != nil {
				logger.Error("health check failed", "error", err)
			}
		}
	}
}

// performHealthCheck checks the health of all services
func performHealthCheck(ctx context.Context, services *WorkerServices) error {
	// Check database
	if err := services.Repository.Health(); err != nil {
		return fmt.Errorf("database unhealthy: %w", err)
	}

	// Check Solana client
	healthCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := services.SolanaClient.Health(healthCtx); err != nil {
		return fmt.Errorf("solana client unhealthy: %w", err)
	}

	// Check event indexer
	if services.EventIndexer != nil {
		if err := services.EventIndexer.Health(healthCtx); err != nil {
			return fmt.Errorf("event indexer unhealthy: %w", err)
		}
	}

	// Check scheduler
	if services.Scheduler != nil {
		if err := services.Scheduler.Health(); err != nil {
			return fmt.Errorf("scheduler unhealthy: %w", err)
		}
	}

	// Check notifier
	if err := services.Notifier.Health(); err != nil {
		return fmt.Errorf("notifier unhealthy: %w", err)
	}

	return nil
}

// setupLogger configures the structured logger
func setupLogger(level string, cfg *config.Config) *slog.Logger {
	var logLevel slog.Level
	switch level {
	case "debug":
		logLevel = slog.LevelDebug
	case "info":
		logLevel = slog.LevelInfo
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level:     logLevel,
		AddSource: true,
	}

	var handler slog.Handler
	if cfg.Environment == "development" {
		// Pretty text logging for development
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		// JSON logging for production
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	logger := slog.New(handler)
	slog.SetDefault(logger)

	return logger
}

// Administrative commands

// dumpIndexerStatus prints the current status of the event indexer
func dumpIndexerStatus(ctx context.Context, services *WorkerServices, logger *slog.Logger) {
	if services.EventIndexer == nil {
		logger.Info("event indexer not enabled")
		return
	}

	status, err := services.EventIndexer.GetIndexingStatus(ctx)
	if err != nil {
		logger.Error("failed to get indexer status", "error", err)
		return
	}

	logger.Info("indexer status", "status", status)
}

// runManualJob runs a specific job manually
func runManualJob(ctx context.Context, services *WorkerServices, jobName string, logger *slog.Logger) error {
	logger.Info("running manual job", "job", jobName)

	switch jobName {
	case "auto_close":
		return services.UseCases.ProcessMarketsNearEnd(ctx)
	case "auto_cancel":
		return services.UseCases.ProcessExpiredMarkets(ctx)
	case "daily_rollup":
		yesterday := time.Now().AddDate(0, 0, -1)
		return services.Analytics.ProcessDailyRollup(ctx, yesterday)
	default:
		return fmt.Errorf("unknown job: %s", jobName)
	}
}