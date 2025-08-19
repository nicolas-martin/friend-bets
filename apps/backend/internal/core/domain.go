package core

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
)

// Market status constants
const (
	MarketStatusOpen          = "open"
	MarketStatusPendingResolve = "pending_resolve"
	MarketStatusResolved      = "resolved"
	MarketStatusCancelled     = "cancelled"
)

// Bet side constants
const (
	BetSideA = "A"
	BetSideB = "B"
)

// Event type constants
const (
	EventMarketInitialized    = "MarketInitialized"
	EventBetPlaced           = "BetPlaced"
	EventBettingClosed       = "BettingClosed"
	EventResolved            = "Resolved"
	EventCancelled           = "Cancelled"
	EventClaimed             = "Claimed"
	EventCreatorFeeWithdrawn = "CreatorFeeWithdrawn"
)

// Market represents a betting market
type Market struct {
	ID                  string
	Creator             string
	Mint                string
	Vault               string
	FeeBps              uint16
	EndTs               time.Time
	ResolveDeadlineTs   time.Time
	StakedA             uint64
	StakedB             uint64
	Status              string
	Outcome             *string
	CreatorFeeWithdrawn bool
	Title               string
	CreatedAt           time.Time
}

// Position represents a user's betting position
type Position struct {
	ID       string
	MarketID string
	Owner    string
	Side     string
	Amount   uint64
	Claimed  bool
}

// MarketEvent represents a blockchain event
type MarketEvent struct {
	TxSignature string
	EventType   string
	MarketID    string
	Data        map[string]interface{}
	Slot        uint64
	BlockTime   time.Time
}

// Odds calculates betting odds for a market
type Odds struct {
	SideA decimal.Decimal
	SideB decimal.Decimal
}

// PayoutInfo contains payout calculation details
type PayoutInfo struct {
	TotalStaked   uint64
	FeeAmount     uint64
	Distributable uint64
	UserPayout    uint64
}

// CreateMarketRequest represents a request to create a market
type CreateMarketRequest struct {
	Creator           string
	Mint              string
	FeeBps            uint16
	EndTs             time.Time
	ResolveDeadlineTs time.Time
	Title             string
}

// PlaceBetRequest represents a request to place a bet
type PlaceBetRequest struct {
	MarketID string
	Owner    string
	Side     string
	Amount   uint64
}

// ResolveMarketRequest represents a request to resolve a market
type ResolveMarketRequest struct {
	MarketID string
	Resolver string
	Outcome  string
}

// ClaimRequest represents a request to claim winnings
type ClaimRequest struct {
	MarketID string
	Owner    string
}

// Validation methods

// ValidateCreateMarket validates a create market request
func ValidateCreateMarket(req *CreateMarketRequest) error {
	if req.Creator == "" {
		return fmt.Errorf("creator is required")
	}
	if req.Mint == "" {
		return fmt.Errorf("mint is required")
	}
	if req.FeeBps > 2000 { // 20% max
		return fmt.Errorf("fee too high (max 20%%)")
	}
	if req.Title == "" {
		return fmt.Errorf("title is required")
	}
	if len(req.Title) > 64 {
		return fmt.Errorf("title too long (max 64 chars)")
	}
	if req.EndTs.Before(time.Now()) {
		return fmt.Errorf("end time must be in the future")
	}
	if req.ResolveDeadlineTs.Before(req.EndTs) {
		return fmt.Errorf("resolve deadline must be after end time")
	}
	return nil
}

// ValidatePlaceBet validates a place bet request
func ValidatePlaceBet(req *PlaceBetRequest, market *Market) error {
	if req.MarketID == "" {
		return fmt.Errorf("market ID is required")
	}
	if req.Owner == "" {
		return fmt.Errorf("owner is required")
	}
	if req.Side != BetSideA && req.Side != BetSideB {
		return fmt.Errorf("side must be A or B")
	}
	if req.Amount == 0 {
		return fmt.Errorf("amount must be greater than 0")
	}
	if market.Status != MarketStatusOpen {
		return fmt.Errorf("market is not open for betting")
	}
	if time.Now().After(market.EndTs) {
		return fmt.Errorf("betting period has ended")
	}
	return nil
}

// ValidateResolveMarket validates a resolve market request
func ValidateResolveMarket(req *ResolveMarketRequest, market *Market) error {
	if req.MarketID == "" {
		return fmt.Errorf("market ID is required")
	}
	if req.Resolver == "" {
		return fmt.Errorf("resolver is required")
	}
	if req.Outcome != BetSideA && req.Outcome != BetSideB {
		return fmt.Errorf("outcome must be A or B")
	}
	if market.Status != MarketStatusPendingResolve {
		return fmt.Errorf("market is not pending resolution")
	}
	if req.Resolver != market.Creator {
		return fmt.Errorf("only creator can resolve market")
	}
	if time.Now().After(market.ResolveDeadlineTs) {
		return fmt.Errorf("resolution deadline has passed")
	}
	return nil
}

// Business logic methods

// CalculateOdds calculates current odds for a market
func (m *Market) CalculateOdds() Odds {
	if m.StakedA == 0 && m.StakedB == 0 {
		return Odds{
			SideA: decimal.NewFromInt(1),
			SideB: decimal.NewFromInt(1),
		}
	}

	totalStaked := decimal.NewFromInt(int64(m.StakedA + m.StakedB))
	
	var sideAOdds, sideBOdds decimal.Decimal
	
	if m.StakedA > 0 {
		sideAOdds = totalStaked.Div(decimal.NewFromInt(int64(m.StakedA)))
	} else {
		sideAOdds = decimal.NewFromInt(0)
	}
	
	if m.StakedB > 0 {
		sideBOdds = totalStaked.Div(decimal.NewFromInt(int64(m.StakedB)))
	} else {
		sideBOdds = decimal.NewFromInt(0)
	}

	return Odds{
		SideA: sideAOdds,
		SideB: sideBOdds,
	}
}

// CalculatePayout calculates the payout for a position
func (m *Market) CalculatePayout(position *Position) PayoutInfo {
	totalStaked := m.StakedA + m.StakedB
	feeAmount := uint64(decimal.NewFromInt(int64(totalStaked)).Mul(decimal.NewFromInt(int64(m.FeeBps))).Div(decimal.NewFromInt(10000)).IntPart())
	distributable := totalStaked - feeAmount

	var userPayout uint64

	if m.Status == MarketStatusCancelled {
		// Refund original amount
		userPayout = position.Amount
	} else if m.Status == MarketStatusResolved && m.Outcome != nil {
		// Calculate proportional payout for winners
		if position.Side == *m.Outcome {
			var winningSideTotal uint64
			if *m.Outcome == BetSideA {
				winningSideTotal = m.StakedA
			} else {
				winningSideTotal = m.StakedB
			}

			if winningSideTotal > 0 {
				userPayout = uint64(decimal.NewFromInt(int64(distributable)).Mul(decimal.NewFromInt(int64(position.Amount))).Div(decimal.NewFromInt(int64(winningSideTotal))).IntPart())
			}
		}
		// Losers get 0 payout
	}

	return PayoutInfo{
		TotalStaked:   totalStaked,
		FeeAmount:     feeAmount,
		Distributable: distributable,
		UserPayout:    userPayout,
	}
}

// IsExpired checks if the market is past its resolve deadline
func (m *Market) IsExpired() bool {
	return time.Now().After(m.ResolveDeadlineTs) && m.Status == MarketStatusPendingResolve
}

// ShouldAutoClose checks if the market should be auto-closed
func (m *Market) ShouldAutoClose() bool {
	return time.Now().After(m.EndTs) && m.Status == MarketStatusOpen
}

// Event parsing utilities

// ParseMarketEvent parses a market event from JSON
func ParseMarketEvent(eventType string, data string) (*MarketEvent, error) {
	var eventData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &eventData); err != nil {
		return nil, fmt.Errorf("failed to parse event data: %w", err)
	}

	event := &MarketEvent{
		EventType: eventType,
		Data:      eventData,
	}

	// Extract common fields
	if marketID, ok := eventData["market"].(string); ok {
		event.MarketID = marketID
	}
	if signature, ok := eventData["signature"].(string); ok {
		event.TxSignature = signature
	}
	if slot, ok := eventData["slot"].(float64); ok {
		event.Slot = uint64(slot)
	}

	return event, nil
}