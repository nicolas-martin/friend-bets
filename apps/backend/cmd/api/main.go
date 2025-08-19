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
	"github.com/friend-bets/backend/internal/grpc"
	"github.com/friend-bets/backend/internal/notify"
	"github.com/friend-bets/backend/internal/rate"
	"github.com/friend-bets/backend/internal/solana"
	"github.com/friend-bets/backend/internal/store"
)

const (
	serviceName = "friend-bets-api"
	version     = "1.0.0"
)

func main() {
	// Parse command line flags
	var (
		configFile = flag.String("config", "", "Path to configuration file")
		logLevel   = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
		showVer    = flag.Bool("version", false, "Show version information")
	)
	flag.Parse()

	if *showVer {
		fmt.Printf("%s version %s\n", serviceName, version)
		os.Exit(0)
	}

	// Initialize logger
	logger := setupLogger(*logLevel)
	logger.Info("starting API server", "service", serviceName, "version", version)

	// Load configuration
	cfg, err := config.Load(*configFile)
	if err != nil {
		logger.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	logger.Info("configuration loaded", "config_file", *configFile)

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
	if err := startServices(ctx, services, logger); err != nil {
		logger.Error("failed to start services", "error", err)
		os.Exit(1)
	}

	logger.Info("API server started successfully", "host", cfg.Server.Host, "port", cfg.Server.Port)

	// Wait for shutdown signal
	<-sigCh
	logger.Info("received shutdown signal, initiating graceful shutdown")

	// Cancel context to signal shutdown
	cancel()

	// Stop services with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := stopServices(shutdownCtx, services, logger); err != nil {
		logger.Error("error during shutdown", "error", err)
		os.Exit(1)
	}

	logger.Info("API server stopped successfully")
}

// Services holds all application services
type Services struct {
	DB           *store.DB
	Repository   *store.Repository
	Analytics    *store.Analytics
	SolanaClient *solana.AnchorClient
	RateLimiter  *rate.Limiter
	Notifier     *notify.Notifier
	GRPCServer   *grpc.Server
}

// initializeServices initializes all application services
func initializeServices(ctx context.Context, cfg *config.Config, logger *slog.Logger) (*Services, error) {
	services := &Services{}

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

	// Initialize Solana client
	logger.Info("initializing Solana client")
	solanaClient, err := solana.NewAnchorClient(&cfg.Solana, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Solana client: %w", err)
	}
	services.SolanaClient = solanaClient

	// Initialize rate limiter
	logger.Info("initializing rate limiter")
	services.RateLimiter = rate.NewLimiter(&cfg.Rate, services.Repository, logger)

	// Initialize notifier
	logger.Info("initializing notification service")
	services.Notifier = notify.NewNotifier(&cfg.Notify, services.Repository, logger)

	// Initialize gRPC server
	logger.Info("initializing gRPC server")
	services.GRPCServer = grpc.NewServer(
		cfg,
		services.Repository,
		services.SolanaClient,
		services.Notifier,
		services.RateLimiter,
		logger,
	)

	logger.Info("all services initialized successfully")
	return services, nil
}

// startServices starts all application services
func startServices(ctx context.Context, services *Services, logger *slog.Logger) error {
	var wg sync.WaitGroup
	errCh := make(chan error, 1)

	// Start gRPC server
	wg.Add(1)
	go func() {
		defer wg.Done()
		logger.Info("starting gRPC server")
		if err := services.GRPCServer.Start(ctx); err != nil {
			select {
			case errCh <- fmt.Errorf("gRPC server error: %w", err):
			default:
			}
		}
	}()

	// Wait a moment for services to start
	time.Sleep(100 * time.Millisecond)

	// Check for immediate startup errors
	select {
	case err := <-errCh:
		return err
	default:
	}

	logger.Info("all services started")
	return nil
}

// stopServices stops all application services
func stopServices(ctx context.Context, services *Services, logger *slog.Logger) error {
	var wg sync.WaitGroup

	// Stop gRPC server
	if services.GRPCServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.Info("stopping gRPC server")
			if err := services.GRPCServer.Stop(ctx); err != nil {
				logger.Error("error stopping gRPC server", "error", err)
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
		logger.Info("all services stopped")
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

// setupLogger configures the structured logger
func setupLogger(level string) *slog.Logger {
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
	if os.Getenv("ENV") == "development" {
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

// Health check endpoint (could be exposed via HTTP if needed)
func healthCheck(services *Services) error {
	// Check database
	if err := services.Repository.Health(); err != nil {
		return fmt.Errorf("database unhealthy: %w", err)
	}

	// Check Solana client
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := services.SolanaClient.Health(ctx); err != nil {
		return fmt.Errorf("solana client unhealthy: %w", err)
	}

	// Check rate limiter
	if err := services.RateLimiter.Health(); err != nil {
		return fmt.Errorf("rate limiter unhealthy: %w", err)
	}

	// Check notifier
	if err := services.Notifier.Health(); err != nil {
		return fmt.Errorf("notifier unhealthy: %w", err)
	}

	return nil
}

