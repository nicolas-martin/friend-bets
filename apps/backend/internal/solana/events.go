package solana

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/blocto/solana-go-sdk/client"
	"github.com/blocto/solana-go-sdk/common"
	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/store"
)

// EventIndexer processes on-chain events from Solana
type EventIndexer struct {
	rpcClient client.Client
	programID common.PublicKey
	config    *config.SolanaConfig
	repo      *store.Repository
	useCases  *core.UseCases
	logger    *slog.Logger
	stopCh    chan struct{}
	doneCh    chan struct{}
}

// NewEventIndexer creates a new event indexer
func NewEventIndexer(cfg *config.SolanaConfig, repo *store.Repository, useCases *core.UseCases, logger *slog.Logger) (*EventIndexer, error) {
	rpcClient := client.NewClient(cfg.RPCURL)
	programID := common.PublicKeyFromString(cfg.ProgramID)

	return &EventIndexer{
		rpcClient: *rpcClient,
		programID: programID,
		config:    cfg,
		repo:      repo,
		useCases:  useCases,
		logger:    logger,
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
	}, nil
}

// Start begins event indexing
func (ei *EventIndexer) Start(ctx context.Context) error {
	ei.logger.Info("starting event indexer", "program_id", ei.programID.ToBase58())

	// Get the latest processed slot
	startSlot, err := ei.repo.GetLatestProcessedSlot()
	if err != nil {
		return fmt.Errorf("failed to get latest processed slot: %w", err)
	}

	ei.logger.Info("starting from slot", "slot", startSlot)

	// Start event processing simulation
	go ei.simulateEventProcessing(ctx)

	return nil
}

// Stop stops the event indexer
func (ei *EventIndexer) Stop() {
	ei.logger.Info("stopping event indexer")
	close(ei.stopCh)
	<-ei.doneCh
}

// simulateEventProcessing simulates event processing for real Solana interaction
func (ei *EventIndexer) simulateEventProcessing(ctx context.Context) {
	defer close(ei.doneCh)
	ei.logger.Info("starting event processing simulation")
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ei.stopCh:
			return
		case <-time.After(30 * time.Second):
			// Get current slot to show we're connected to RPC
			currentSlot, err := ei.rpcClient.GetSlot(ctx)
			if err != nil {
				ei.logger.Error("failed to get current slot", "error", err)
				continue
			}
			ei.logger.Debug("event processing cycle", "current_slot", currentSlot)
		}
	}
}

// Health check
func (ei *EventIndexer) Health(ctx context.Context) error {
	// Check if we can connect to RPC
	_, err := ei.rpcClient.GetSlot(ctx)
	if err != nil {
		return fmt.Errorf("RPC health check failed: %w", err)
	}

	return nil
}

// GetIndexingStatus returns the current indexing status
func (ei *EventIndexer) GetIndexingStatus(ctx context.Context) (map[string]interface{}, error) {
	latestProcessedSlot, err := ei.repo.GetLatestProcessedSlot()
	if err != nil {
		return nil, fmt.Errorf("failed to get latest processed slot: %w", err)
	}

	currentSlot, err := ei.rpcClient.GetSlot(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get current slot: %w", err)
	}

	return map[string]interface{}{
		"latest_processed_slot": latestProcessedSlot,
		"current_slot":          currentSlot,
		"slots_behind":          currentSlot - latestProcessedSlot,
		"websocket_connected":   false, // Simplified version doesn't use websocket
	}, nil
}