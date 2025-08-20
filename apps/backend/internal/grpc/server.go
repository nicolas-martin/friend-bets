package grpc

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"github.com/friend-bets/backend/gen/proto/bets/v1/betsv1connect"
	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/notify"
	"github.com/friend-bets/backend/internal/rate"
	"github.com/friend-bets/backend/internal/solana"
	"github.com/friend-bets/backend/internal/store"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

// Server represents the gRPC server
type Server struct {
	config       *config.Config
	httpServer   *http.Server
	useCases     *core.UseCases
	solanaClient *solana.AnchorClient
	notifier     *notify.Notifier
	rateLimiter  *rate.Limiter
	logger       *slog.Logger
}

// NewServer creates a new gRPC server instance
func NewServer(
	cfg *config.Config,
	repo *store.Repository,
	solanaClient *solana.AnchorClient,
	notifier *notify.Notifier,
	rateLimiter *rate.Limiter,
	logger *slog.Logger,
) *Server {
	useCases := core.NewUseCases(repo, cfg, logger)

	return &Server{
		config:       cfg,
		useCases:     useCases,
		solanaClient: solanaClient,
		notifier:     notifier,
		rateLimiter:  rateLimiter,
		logger:       logger,
	}
}

// Start starts the gRPC server
func (s *Server) Start(ctx context.Context) error {
	// Create main HTTP mux
	mainMux := http.NewServeMux()

	// Create gRPC mux
	grpcMux := http.NewServeMux()

	// Create interceptors for MVP (auth disabled)
	interceptors := connect.WithInterceptors(
		NewLoggingInterceptor(s.logger),
		// NewRateLimitInterceptor(s.rateLimiter), // Disabled for MVP
		// NewAuthInterceptor(s.logger), // Disabled for MVP
	)

	// Enable betting service for MVP
	betsService := NewBetsService(s.useCases, s.solanaClient, s.notifier, s.logger)
	betsServicePath, betsServiceHandler := betsv1connect.NewBetsServiceHandler(betsService, interceptors)
	grpcMux.Handle(betsServicePath, betsServiceHandler)

	// Add proper CORS wrapper
	c := cors.New(cors.Options{
		AllowedOrigins: []string{
			"http://localhost:9001", "http://127.0.0.1:9001",
		},
		AllowedMethods:   connectcors.AllowedMethods(),
		AllowedHeaders:   connectcors.AllowedHeaders(),
		ExposedHeaders:   connectcors.ExposedHeaders(),
		AllowCredentials: true,
	})

	// Add gRPC endpoints with h2c wrapper and CORS
	mainMux.Handle("/bets.v1.BetsService/", h2c.NewHandler(c.Handler(grpcMux), &http2.Server{}))

	// Add simple HTTP health check endpoint (no h2c wrapper)
	mainMux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"friend-bets-api"}`))
	})

	// Create HTTP server
	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf("%s:%d", s.config.Server.Host, s.config.Server.Port),
		Handler: mainMux,
		BaseContext: func(_ net.Listener) context.Context {
			return ctx
		},
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.logger.Info("starting gRPC server", "addr", s.httpServer.Addr)

	// Start server
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("failed to start server: %w", err)
	}

	return nil
}

// Stop gracefully stops the server
func (s *Server) Stop(ctx context.Context) error {
	s.logger.Info("stopping gRPC server")

	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}

	return nil
}

// addCORS adds CORS headers to the handler
func (s *Server) addCORS(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		for _, origin := range s.config.Server.CORS.AllowedOrigins {
			if origin == "*" || origin == r.Header.Get("Origin") {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

		allowedHeaders := "Accept, Authorization, Content-Type, X-CSRF-Token"
		if len(s.config.Server.CORS.AllowedHeaders) > 0 {
			allowedHeaders = ""
			for i, header := range s.config.Server.CORS.AllowedHeaders {
				if i > 0 {
					allowedHeaders += ", "
				}
				allowedHeaders += header
			}
		}
		w.Header().Set("Access-Control-Allow-Headers", allowedHeaders)

		w.Header().Set("Access-Control-Expose-Headers", "Content-Length")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Handle preflight OPTIONS request
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		handler.ServeHTTP(w, r)
	})
}

// Health check endpoint
func (s *Server) Health() error {
	// Check if server is running
	if s.httpServer == nil {
		return fmt.Errorf("server not started")
	}

	// Could add more health checks here (database, Solana RPC, etc.)
	return nil
}

// Metrics endpoint for monitoring
func (s *Server) Metrics() map[string]interface{} {
	return map[string]interface{}{
		"server_addr": s.httpServer.Addr,
		"status":      "running",
		"timestamp":   time.Now().Unix(),
	}
}
