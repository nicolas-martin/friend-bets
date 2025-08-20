package core

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/store"
)

// UseCases implements business logic layer
type UseCases struct {
	repo   *store.Repository
	config *config.Config
	logger *slog.Logger
}

// NewUseCases creates a new UseCases instance
func NewUseCases(repo *store.Repository, cfg *config.Config, logger *slog.Logger) *UseCases {
	return &UseCases{
		repo:   repo,
		config: cfg,
		logger: logger,
	}
}

// Market Use Cases

// ValidateCreateMarket validates a market creation request without persisting it
func (uc *UseCases) ValidateCreateMarket(ctx context.Context, req *CreateMarketRequest) error {
	return ValidateCreateMarket(req)
}

// CreateMarket creates a new betting market
func (uc *UseCases) CreateMarket(ctx context.Context, req *CreateMarketRequest) (*Market, error) {
	// Validate request
	if err := ValidateCreateMarket(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Use provided market ID (on-chain PDA) or generate one if not provided
	marketID := req.MarketID
	if marketID == "" {
		marketID = generateMarketID()
	}

	// Create market domain object
	market := &Market{
		ID:                marketID,
		Creator:           req.Creator,
		Mint:              req.Mint,
		Vault:             "", // Will be set by Solana program
		FeeBps:            req.FeeBps,
		EndTs:             req.EndTs,
		ResolveDeadlineTs: req.ResolveDeadlineTs,
		StakedA:           0,
		StakedB:           0,
		Status:            MarketStatusOpen,
		Title:             strings.TrimSpace(req.Title),
		CreatedAt:         time.Now(),
	}

	// Convert to store model
	marketView := &store.MarketView{
		ID:                market.ID,
		Creator:           market.Creator,
		Mint:              market.Mint,
		Vault:             market.Vault,
		FeeBps:            market.FeeBps,
		EndTs:             market.EndTs,
		ResolveDeadlineTs: market.ResolveDeadlineTs,
		StakedA:           market.StakedA,
		StakedB:           market.StakedB,
		Status:            market.Status,
		Title:             market.Title,
		CreatedAt:         market.CreatedAt,
	}

	// Save to database
	if err := uc.repo.CreateMarket(marketView); err != nil {
		uc.logger.Error("failed to create market", "error", err, "market_id", marketID)
		return nil, fmt.Errorf("failed to create market: %w", err)
	}

	uc.logger.Info("market created", "market_id", marketID, "creator", req.Creator, "title", req.Title)

	return market, nil
}

// GetMarket retrieves a market by ID
func (uc *UseCases) GetMarket(ctx context.Context, marketID string) (*Market, error) {
	marketView, err := uc.repo.GetMarket(marketID)
	if err != nil {
		return nil, fmt.Errorf("market not found: %w", err)
	}

	return uc.convertMarketViewToDomain(marketView), nil
}

// ListMarkets retrieves markets with filtering and pagination
func (uc *UseCases) ListMarkets(ctx context.Context, titleFilter, statusFilter string, limit, offset int) ([]*Market, error) {
	if limit <= 0 || limit > 100 {
		limit = 20 // Default page size
	}

	marketViews, err := uc.repo.ListMarkets(titleFilter, statusFilter, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list markets: %w", err)
	}

	markets := make([]*Market, len(marketViews))
	for i, mv := range marketViews {
		markets[i] = uc.convertMarketViewToDomain(&mv)
	}

	return markets, nil
}

// PlaceBet places a bet on a market
func (uc *UseCases) PlaceBet(ctx context.Context, req *PlaceBetRequest) (*Position, error) {
	// Get market
	market, err := uc.GetMarket(ctx, req.MarketID)
	if err != nil {
		return nil, fmt.Errorf("market not found: %w", err)
	}

	// Validate request
	if err := ValidatePlaceBet(req, market); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Generate position ID
	positionID := generatePositionID()

	// Create position
	position := &Position{
		ID:       positionID,
		MarketID: req.MarketID,
		Owner:    req.Owner,
		Side:     req.Side,
		Amount:   req.Amount,
		Claimed:  false,
	}

	// Convert to store model
	positionView := &store.PositionView{
		ID:       position.ID,
		MarketID: position.MarketID,
		Owner:    position.Owner,
		Side:     position.Side,
		Amount:   position.Amount,
		Claimed:  position.Claimed,
	}

	// Save to database (this will be updated by event indexer with actual on-chain data)
	if err := uc.repo.CreateOrUpdatePosition(positionView); err != nil {
		uc.logger.Error("failed to create position", "error", err, "position_id", positionID)
		return nil, fmt.Errorf("failed to create position: %w", err)
	}

	uc.logger.Info("bet placed", "position_id", positionID, "market_id", req.MarketID, "owner", req.Owner, "side", req.Side, "amount", req.Amount)

	return position, nil
}

// ResolveMarket resolves a market with an outcome
func (uc *UseCases) ResolveMarket(ctx context.Context, req *ResolveMarketRequest) error {
	// Get market
	market, err := uc.GetMarket(ctx, req.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	// Validate request
	if err := ValidateResolveMarket(req, market); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	uc.logger.Info("market resolved", "market_id", req.MarketID, "outcome", req.Outcome, "resolver", req.Resolver)

	return nil
}

// GetUserPositions retrieves all positions for a user
func (uc *UseCases) GetUserPositions(ctx context.Context, userID string) ([]*Position, error) {
	positionViews, err := uc.repo.GetPositionsByUser(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user positions: %w", err)
	}

	positions := make([]*Position, len(positionViews))
	for i, pv := range positionViews {
		positions[i] = uc.convertPositionViewToDomain(&pv)
	}

	return positions, nil
}

// GetPosition gets a specific position by market ID and owner
func (uc *UseCases) GetPosition(ctx context.Context, marketID, owner string) (*Position, error) {
	positionView, err := uc.repo.GetUserPosition(marketID, owner)
	if err != nil {
		return nil, fmt.Errorf("failed to get position: %w", err)
	}

	return uc.convertPositionViewToDomain(positionView), nil
}

// GetUserPositionsWithPagination gets user positions with pagination support
func (uc *UseCases) GetUserPositionsWithPagination(ctx context.Context, userID string, limit, offset int) ([]*Position, error) {
	// For now, we'll use the existing method and apply pagination in memory
	// In a production system, you'd want to implement this at the repository level
	allPositions, err := uc.GetUserPositions(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Apply pagination
	start := offset
	if start > len(allPositions) {
		return []*Position{}, nil
	}

	end := start + limit
	if end > len(allPositions) {
		end = len(allPositions)
	}

	return allPositions[start:end], nil
}

// Auto-resolution tasks for background workers

// ProcessMarketsNearEnd identifies markets nearing their end time
func (uc *UseCases) ProcessMarketsNearEnd(ctx context.Context) error {
	// Get markets ending in the next hour
	markets, err := uc.repo.GetMarketsNearEnd(time.Hour)
	if err != nil {
		return fmt.Errorf("failed to get markets near end: %w", err)
	}

	for _, market := range markets {
		if time.Now().After(market.EndTs) && market.Status == "open" {
			// Update status to pending_resolve
			market.Status = MarketStatusPendingResolve
			if err := uc.repo.UpdateMarket(&market); err != nil {
				uc.logger.Error("failed to update market status", "error", err, "market_id", market.ID)
				continue
			}
			uc.logger.Info("market moved to pending resolve", "market_id", market.ID)
		}
	}

	return nil
}

// ProcessExpiredMarkets handles markets past their resolve deadline
func (uc *UseCases) ProcessExpiredMarkets(ctx context.Context) error {
	if !uc.config.Worker.AutoCancelEnabled {
		return nil
	}

	markets, err := uc.repo.GetExpiredUnresolvedMarkets()
	if err != nil {
		return fmt.Errorf("failed to get expired markets: %w", err)
	}

	for _, market := range markets {
		// Cancel expired markets
		market.Status = MarketStatusCancelled
		if err := uc.repo.UpdateMarket(&market); err != nil {
			uc.logger.Error("failed to cancel expired market", "error", err, "market_id", market.ID)
			continue
		}
		uc.logger.Info("expired market cancelled", "market_id", market.ID)
	}

	return nil
}

// Event processing for indexer

// ProcessMarketEvent processes a market event from Solana
func (uc *UseCases) ProcessMarketEvent(ctx context.Context, event *MarketEvent) error {
	uc.logger.Debug("processing market event", "type", event.EventType, "market_id", event.MarketID, "tx", event.TxSignature)

	switch event.EventType {
	case EventMarketInitialized:
		return uc.processMarketInitialized(event)
	case EventBetPlaced:
		return uc.processBetPlaced(event)
	case EventBettingClosed:
		return uc.processBettingClosed(event)
	case EventResolved:
		return uc.processResolved(event)
	case EventCancelled:
		return uc.processCancelled(event)
	case EventClaimed:
		return uc.processClaimed(event)
	case EventCreatorFeeWithdrawn:
		return uc.processCreatorFeeWithdrawn(event)
	default:
		uc.logger.Warn("unknown event type", "type", event.EventType)
		return nil
	}
}

// Private helper methods

func (uc *UseCases) convertMarketViewToDomain(mv *store.MarketView) *Market {
	return &Market{
		ID:                  mv.ID,
		Creator:             mv.Creator,
		Mint:                mv.Mint,
		Vault:               mv.Vault,
		FeeBps:              mv.FeeBps,
		EndTs:               mv.EndTs,
		ResolveDeadlineTs:   mv.ResolveDeadlineTs,
		StakedA:             mv.StakedA,
		StakedB:             mv.StakedB,
		Status:              mv.Status,
		Outcome:             mv.Outcome,
		CreatorFeeWithdrawn: mv.CreatorFeeWithdrawn,
		Title:               mv.Title,
		CreatedAt:           mv.CreatedAt,
	}
}

func (uc *UseCases) convertPositionViewToDomain(pv *store.PositionView) *Position {
	return &Position{
		ID:       pv.ID,
		MarketID: pv.MarketID,
		Owner:    pv.Owner,
		Side:     pv.Side,
		Amount:   pv.Amount,
		Claimed:  pv.Claimed,
	}
}

func (uc *UseCases) processMarketInitialized(event *MarketEvent) error {
	// Update market with on-chain data
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	// Extract vault address from event data
	if vault, ok := event.Data["vault"].(string); ok {
		market.Vault = vault
	}

	return uc.repo.UpdateMarket(market)
}

func (uc *UseCases) processBetPlaced(event *MarketEvent) error {
	// Update market stakes and position
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	// Extract data from event
	amount, _ := event.Data["amount"].(float64)
	side, _ := event.Data["side"].(string)
	owner, _ := event.Data["owner"].(string)

	// Update market stakes
	if side == BetSideA {
		market.StakedA += uint64(amount)
	} else {
		market.StakedB += uint64(amount)
	}

	if err := uc.repo.UpdateMarket(market); err != nil {
		return fmt.Errorf("failed to update market: %w", err)
	}

	// Update or create position
	positionID := generatePositionID()
	position := &store.PositionView{
		ID:       positionID,
		MarketID: event.MarketID,
		Owner:    owner,
		Side:     side,
		Amount:   uint64(amount),
		Claimed:  false,
	}

	return uc.repo.CreateOrUpdatePosition(position)
}

func (uc *UseCases) processBettingClosed(event *MarketEvent) error {
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	market.Status = MarketStatusPendingResolve
	return uc.repo.UpdateMarket(market)
}

func (uc *UseCases) processResolved(event *MarketEvent) error {
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	outcome, _ := event.Data["outcome"].(string)
	market.Status = MarketStatusResolved
	market.Outcome = &outcome

	return uc.repo.UpdateMarket(market)
}

func (uc *UseCases) processCancelled(event *MarketEvent) error {
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	market.Status = MarketStatusCancelled
	return uc.repo.UpdateMarket(market)
}

func (uc *UseCases) processClaimed(event *MarketEvent) error {
	owner, _ := event.Data["owner"].(string)
	position, err := uc.repo.GetUserPosition(event.MarketID, owner)
	if err != nil {
		return fmt.Errorf("position not found: %w", err)
	}

	position.Claimed = true
	return uc.repo.CreateOrUpdatePosition(position)
}

func (uc *UseCases) processCreatorFeeWithdrawn(event *MarketEvent) error {
	market, err := uc.repo.GetMarket(event.MarketID)
	if err != nil {
		return fmt.Errorf("market not found: %w", err)
	}

	market.CreatorFeeWithdrawn = true
	return uc.repo.UpdateMarket(market)
}


// Utility functions

func generateMarketID() string {
	return fmt.Sprintf("market_%d", time.Now().UnixNano())
}

func generatePositionID() string {
	return fmt.Sprintf("position_%d", time.Now().UnixNano())
}