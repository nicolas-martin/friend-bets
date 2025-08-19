package solana

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/store"
	"github.com/gorilla/websocket"
	"github.com/portto/solana-go-sdk/client"
	"github.com/portto/solana-go-sdk/common"
	"github.com/portto/solana-go-sdk/rpc"
)

// EventIndexer processes on-chain events from Solana
type EventIndexer struct {
	rpcClient   client.Client
	wsClient    *websocket.Conn
	programID   common.PublicKey
	config      *config.SolanaConfig
	repo        *store.Repository
	useCases    *core.UseCases
	logger      *slog.Logger
	stopCh      chan struct{}
	doneCh      chan struct{}
}

// NewEventIndexer creates a new event indexer
func NewEventIndexer(cfg *config.SolanaConfig, repo *store.Repository, useCases *core.UseCases, logger *slog.Logger) (*EventIndexer, error) {
	rpcClient := client.NewClient(cfg.RPCURL)
	
	programID, err := common.PublicKeyFromBase58(cfg.ProgramID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	return &EventIndexer{
		rpcClient: rpcClient,
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

	// Use config override if available
	if ei.config.IndexerStartSlot > 0 && startSlot == 0 {
		startSlot = ei.config.IndexerStartSlot
	}

	ei.logger.Info("starting from slot", "slot", startSlot)

	// Start historical processing if needed
	go ei.processHistoricalEvents(ctx, startSlot)

	// Start real-time WebSocket processing
	go ei.processRealtimeEvents(ctx)

	return nil
}

// Stop stops the event indexer
func (ei *EventIndexer) Stop() {
	ei.logger.Info("stopping event indexer")
	close(ei.stopCh)
	<-ei.doneCh
}

// processHistoricalEvents processes historical events from a starting slot
func (ei *EventIndexer) processHistoricalEvents(ctx context.Context, startSlot uint64) {
	defer func() {
		if r := recover(); r != nil {
			ei.logger.Error("historical event processing panic", "error", r)
		}
	}()

	ei.logger.Info("processing historical events", "start_slot", startSlot)

	// Get current slot
	currentSlot, err := ei.rpcClient.GetSlot(ctx)
	if err != nil {
		ei.logger.Error("failed to get current slot", "error", err)
		return
	}

	// Process in chunks to avoid overwhelming the RPC
	const chunkSize = 1000
	for slot := startSlot; slot < currentSlot; slot += chunkSize {
		select {
		case <-ctx.Done():
			return
		case <-ei.stopCh:
			return
		default:
		}

		endSlot := slot + chunkSize
		if endSlot > currentSlot {
			endSlot = currentSlot
		}

		if err := ei.processSlotRange(ctx, slot, endSlot); err != nil {
			ei.logger.Error("failed to process slot range", "error", err, "start_slot", slot, "end_slot", endSlot)
			// Continue processing other slots
		}

		// Rate limiting to avoid overwhelming RPC
		time.Sleep(100 * time.Millisecond)
	}

	ei.logger.Info("finished processing historical events", "processed_up_to", currentSlot)
}

// processRealtimeEvents processes real-time events via WebSocket
func (ei *EventIndexer) processRealtimeEvents(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			ei.logger.Error("realtime event processing panic", "error", r)
		}
		close(ei.doneCh)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ei.stopCh:
			return
		default:
		}

		if err := ei.connectAndListenWebSocket(ctx); err != nil {
			ei.logger.Error("websocket connection failed", "error", err)
			// Reconnect after delay
			time.Sleep(5 * time.Second)
		}
	}
}

// connectAndListenWebSocket establishes WebSocket connection and listens for events
func (ei *EventIndexer) connectAndListenWebSocket(ctx context.Context) error {
	// Convert HTTP URL to WebSocket URL
	wsURL := ei.config.RPCURL
	if wsURL[:4] == "http" {
		wsURL = "ws" + wsURL[4:]
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to websocket: %w", err)
	}
	defer conn.Close()

	ei.wsClient = conn

	// Subscribe to program account changes
	subscribeRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "programSubscribe",
		"params": []interface{}{
			ei.programID.ToBase58(),
			map[string]interface{}{
				"commitment": ei.config.ConfirmationMode,
				"encoding":   "base64",
			},
		},
	}

	if err := conn.WriteJSON(subscribeRequest); err != nil {
		return fmt.Errorf("failed to send subscription request: %w", err)
	}

	// Read subscription confirmation
	var subscribeResponse map[string]interface{}
	if err := conn.ReadJSON(&subscribeResponse); err != nil {
		return fmt.Errorf("failed to read subscription response: %w", err)
	}

	ei.logger.Info("subscribed to program events", "program_id", ei.programID.ToBase58())

	// Process incoming messages
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ei.stopCh:
			return nil
		default:
		}

		var message map[string]interface{}
		if err := conn.ReadJSON(&message); err != nil {
			return fmt.Errorf("failed to read websocket message: %w", err)
		}

		if err := ei.processWebSocketMessage(ctx, message); err != nil {
			ei.logger.Error("failed to process websocket message", "error", err)
		}
	}
}

// processWebSocketMessage processes a WebSocket message
func (ei *EventIndexer) processWebSocketMessage(ctx context.Context, message map[string]interface{}) error {
	// Check if this is a program account notification
	if method, ok := message["method"].(string); ok && method == "programNotification" {
		params, ok := message["params"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid params in program notification")
		}

		result, ok := params["result"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid result in program notification")
		}

		context, ok := result["context"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid context in program notification")
		}

		slot, ok := context["slot"].(float64)
		if !ok {
			return fmt.Errorf("invalid slot in program notification")
		}

		value, ok := result["value"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid value in program notification")
		}

		account, ok := value["account"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid account in program notification")
		}

		pubkey, ok := value["pubkey"].(string)
		if !ok {
			return fmt.Errorf("invalid pubkey in program notification")
		}

		// Process the account change
		return ei.processAccountChange(ctx, pubkey, account, uint64(slot))
	}

	return nil
}

// processAccountChange processes an account change notification
func (ei *EventIndexer) processAccountChange(ctx context.Context, pubkey string, account map[string]interface{}, slot uint64) error {
	// Get account data
	data, ok := account["data"].([]interface{})
	if !ok || len(data) < 2 {
		return fmt.Errorf("invalid account data")
	}

	accountDataB64, ok := data[0].(string)
	if !ok {
		return fmt.Errorf("invalid account data encoding")
	}

	// Parse account data to determine event type
	events, err := ei.parseAccountData(accountDataB64, pubkey, slot)
	if err != nil {
		return fmt.Errorf("failed to parse account data: %w", err)
	}

	// Process each event
	for _, event := range events {
		if err := ei.processEvent(ctx, event); err != nil {
			ei.logger.Error("failed to process event", "error", err, "event_type", event.EventType)
		}
	}

	return nil
}

// processSlotRange processes events in a slot range using getSignaturesForAddress
func (ei *EventIndexer) processSlotRange(ctx context.Context, startSlot, endSlot uint64) error {
	// Get signatures for the program
	signatures, err := ei.rpcClient.GetSignaturesForAddressWithConfig(
		ctx,
		ei.programID.ToBase58(),
		rpc.GetSignaturesForAddressConfig{
			Limit: 1000,
		},
	)
	if err != nil {
		return fmt.Errorf("failed to get signatures: %w", err)
	}

	// Filter signatures by slot range
	var relevantSignatures []rpc.TransactionSignature
	for _, sig := range signatures {
		if sig.Slot != nil && *sig.Slot >= startSlot && *sig.Slot < endSlot {
			relevantSignatures = append(relevantSignatures, sig)
		}
	}

	// Process each transaction
	for _, sig := range relevantSignatures {
		if err := ei.processTransaction(ctx, sig.Signature, *sig.Slot); err != nil {
			ei.logger.Error("failed to process transaction", "error", err, "signature", sig.Signature)
		}
	}

	return nil
}

// processTransaction processes a single transaction
func (ei *EventIndexer) processTransaction(ctx context.Context, signature string, slot uint64) error {
	// Get transaction details
	tx, err := ei.rpcClient.GetTransactionWithConfig(
		ctx,
		signature,
		rpc.GetTransactionConfig{
			Encoding: "json",
		},
	)
	if err != nil {
		return fmt.Errorf("failed to get transaction: %w", err)
	}

	if tx.Meta == nil {
		return fmt.Errorf("transaction meta is nil")
	}

	// Parse log messages for events
	events := ei.parseTransactionLogs(tx.Meta.LogMessages, signature, slot)

	// Process each event
	for _, event := range events {
		if err := ei.processEvent(ctx, event); err != nil {
			ei.logger.Error("failed to process event", "error", err, "event_type", event.EventType)
		}
	}

	return nil
}

// parseTransactionLogs parses log messages for program events
func (ei *EventIndexer) parseTransactionLogs(logs []string, signature string, slot uint64) []*core.MarketEvent {
	var events []*core.MarketEvent

	for _, log := range logs {
		// Look for program log messages that contain event data
		// Anchor programs emit logs like: "Program log: EVENT_NAME {json_data}"
		if len(log) > 12 && log[:12] == "Program log:" {
			eventLog := log[13:] // Remove "Program log: "
			
			// Try to parse as event
			if event := ei.parseEventLog(eventLog, signature, slot); event != nil {
				events = append(events, event)
			}
		}
	}

	return events
}

// parseEventLog parses a single event log
func (ei *EventIndexer) parseEventLog(eventLog, signature string, slot uint64) *core.MarketEvent {
	// Look for known event patterns
	eventTypes := []string{
		core.EventMarketInitialized,
		core.EventBetPlaced,
		core.EventBettingClosed,
		core.EventResolved,
		core.EventCancelled,
		core.EventClaimed,
		core.EventCreatorFeeWithdrawn,
	}

	for _, eventType := range eventTypes {
		if len(eventLog) > len(eventType) && eventLog[:len(eventType)] == eventType {
			// Extract JSON data
			jsonStart := len(eventType) + 1 // +1 for space
			if jsonStart < len(eventLog) {
				jsonData := eventLog[jsonStart:]
				
				// Parse JSON
				var data map[string]interface{}
				if err := json.Unmarshal([]byte(jsonData), &data); err == nil {
					event := &core.MarketEvent{
						TxSignature: signature,
						EventType:   eventType,
						Data:        data,
						Slot:        slot,
						BlockTime:   time.Now(), // Would get from transaction
					}

					// Extract market ID
					if marketID, ok := data["market"].(string); ok {
						event.MarketID = marketID
					}

					return event
				}
			}
		}
	}

	return nil
}

// parseAccountData parses account data for state changes that imply events
func (ei *EventIndexer) parseAccountData(dataB64, pubkey string, slot uint64) ([]*core.MarketEvent, error) {
	// This would parse account data to detect state changes
	// For now, return empty slice as we're focusing on log-based events
	return []*core.MarketEvent{}, nil
}

// processEvent processes a parsed market event
func (ei *EventIndexer) processEvent(ctx context.Context, event *core.MarketEvent) error {
	// Store event in database
	eventLog := &store.EventLog{
		TxSignature: event.TxSignature,
		EventType:   event.EventType,
		MarketID:    &event.MarketID,
		Slot:        event.Slot,
		BlockTime:   event.BlockTime,
	}

	// Serialize event data
	dataJSON, err := json.Marshal(event.Data)
	if err != nil {
		return fmt.Errorf("failed to marshal event data: %w", err)
	}
	eventLog.Data = string(dataJSON)

	// Store in database
	if err := ei.repo.CreateEventLog(eventLog); err != nil {
		return fmt.Errorf("failed to store event log: %w", err)
	}

	// Process event through use cases
	if err := ei.useCases.ProcessMarketEvent(ctx, event); err != nil {
		ei.logger.Error("failed to process market event", "error", err, "event_type", event.EventType)
		// Don't return error as we still want to continue processing
	}

	ei.logger.Debug("processed event", "type", event.EventType, "market_id", event.MarketID, "slot", event.Slot)

	return nil
}

// Health check
func (ei *EventIndexer) Health(ctx context.Context) error {
	// Check if we can connect to RPC
	_, err := ei.rpcClient.GetHealth(ctx)
	if err != nil {
		return fmt.Errorf("RPC health check failed: %w", err)
	}

	// Check if WebSocket is connected
	if ei.wsClient == nil {
		return fmt.Errorf("websocket not connected")
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
		"websocket_connected":   ei.wsClient != nil,
	}, nil
}