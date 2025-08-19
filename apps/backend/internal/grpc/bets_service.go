package grpc

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/notify"
	"github.com/friend-bets/backend/internal/solana"
)

// BetsService implements the betting service
type BetsService struct {
	useCases     *core.UseCases
	solanaClient *solana.AnchorClient
	notifier     *notify.Notifier
	logger       *slog.Logger

	// Event streaming
	eventStreams map[string]chan *MarketEvent
	streamsMux   sync.RWMutex
}

// MarketEvent represents a streaming market event
type MarketEvent struct {
	ID          string
	MarketID    string
	EventType   string
	Data        string
	Timestamp   int64
	TxSignature string
}

// NewBetsService creates a new betting service
func NewBetsService(
	useCases *core.UseCases,
	solanaClient *solana.AnchorClient,
	notifier *notify.Notifier,
	logger *slog.Logger,
) *BetsService {
	return &BetsService{
		useCases:     useCases,
		solanaClient: solanaClient,
		notifier:     notifier,
		logger:       logger,
		eventStreams: make(map[string]chan *MarketEvent),
	}
}

// ListMarkets lists available markets
func (s *BetsService) ListMarkets(
	ctx context.Context,
	req *connect.Request[ListMarketsRequest],
) (*connect.Response[ListMarketsResponse], error) {
	// Parse pagination
	limit := int(req.Msg.PageSize)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	// Parse page token to get offset
	offset := 0
	if req.Msg.PageToken != "" {
		if parsed, err := strconv.Atoi(req.Msg.PageToken); err == nil {
			offset = parsed
		}
	}

	// Convert status filter
	statusFilter := ""
	switch req.Msg.StatusFilter {
	case MarketStatus_MARKET_STATUS_OPEN:
		statusFilter = core.MarketStatusOpen
	case MarketStatus_MARKET_STATUS_PENDING_RESOLVE:
		statusFilter = core.MarketStatusPendingResolve
	case MarketStatus_MARKET_STATUS_RESOLVED:
		statusFilter = core.MarketStatusResolved
	case MarketStatus_MARKET_STATUS_CANCELLED:
		statusFilter = core.MarketStatusCancelled
	}

	// Get markets from use cases
	markets, err := s.useCases.ListMarkets(ctx, req.Msg.TitleFilter, statusFilter, limit, offset)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list markets: %w", err))
	}

	// Convert to protobuf format
	pbMarkets := make([]*Market, len(markets))
	for i, market := range markets {
		pbMarkets[i] = s.convertMarketToProto(market)
	}

	// Generate next page token
	nextPageToken := ""
	if len(markets) == limit {
		nextPageToken = strconv.Itoa(offset + limit)
	}

	response := &ListMarketsResponse{
		Markets:       pbMarkets,
		NextPageToken: nextPageToken,
	}

	return connect.NewResponse(response), nil
}

// CreateMarket creates a new betting market
func (s *BetsService) CreateMarket(
	ctx context.Context,
	req *connect.Request[CreateMarketRequest],
) (*connect.Response[CreateMarketResponse], error) {
	// Extract creator from auth context
	creator, ok := ctx.Value("user_id").(string)
	if !ok || creator == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user authentication required"))
	}

	// Create domain request
	createReq := &core.CreateMarketRequest{
		Creator:           creator,
		Mint:              req.Msg.Mint,
		FeeBps:            uint16(req.Msg.FeeBps),
		EndTs:             time.Unix(req.Msg.EndTs, 0),
		ResolveDeadlineTs: time.Unix(req.Msg.ResolveDeadlineTs, 0),
		Title:             req.Msg.Title,
	}

	// Validate through use cases
	market, err := s.useCases.CreateMarket(ctx, createReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to create market: %w", err))
	}

	// Create Solana transaction
	txResult, err := s.solanaClient.CreateMarketTx(ctx, createReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create transaction: %w", err))
	}

	s.logger.Info("market created", "market_id", market.ID, "creator", creator)

	// Send notification
	if s.notifier != nil {
		go func() {
			if err := s.notifier.NotifyMarketCreated(context.Background(), market); err != nil {
				s.logger.Error("failed to send market created notification", "error", err)
			}
		}()
	}

	response := &CreateMarketResponse{
		MarketId:         market.ID,
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// PlaceBet places a bet on a market
func (s *BetsService) PlaceBet(
	ctx context.Context,
	req *connect.Request[PlaceBetRequest],
) (*connect.Response[PlaceBetResponse], error) {
	// Extract owner from auth context
	owner, ok := ctx.Value("user_id").(string)
	if !ok || owner == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user authentication required"))
	}

	// Convert side
	var side string
	switch req.Msg.Side {
	case Side_SIDE_A:
		side = core.BetSideA
	case Side_SIDE_B:
		side = core.BetSideB
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid side"))
	}

	// Create domain request
	betReq := &core.PlaceBetRequest{
		MarketID: req.Msg.MarketId,
		Owner:    owner,
		Side:     side,
		Amount:   req.Msg.Amount,
	}

	// Validate through use cases
	position, err := s.useCases.PlaceBet(ctx, betReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to place bet: %w", err))
	}

	// Create Solana transaction
	txResult, err := s.solanaClient.PlaceBetTx(ctx, betReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create transaction: %w", err))
	}

	s.logger.Info("bet placed", "position_id", position.ID, "market_id", req.Msg.MarketId, "owner", owner)

	// Send notification
	if s.notifier != nil {
		go func() {
			if err := s.notifier.NotifyBetPlaced(context.Background(), position); err != nil {
				s.logger.Error("failed to send bet placed notification", "error", err)
			}
		}()
	}

	response := &PlaceBetResponse{
		PositionId:       position.ID,
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// Resolve resolves a market outcome
func (s *BetsService) Resolve(
	ctx context.Context,
	req *connect.Request[ResolveRequest],
) (*connect.Response[ResolveResponse], error) {
	// Extract resolver from auth context
	resolver, ok := ctx.Value("user_id").(string)
	if !ok || resolver == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user authentication required"))
	}

	// Convert outcome
	var outcome string
	switch req.Msg.Outcome {
	case Side_SIDE_A:
		outcome = core.BetSideA
	case Side_SIDE_B:
		outcome = core.BetSideB
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid outcome"))
	}

	// Create domain request
	resolveReq := &core.ResolveMarketRequest{
		MarketID: req.Msg.MarketId,
		Resolver: resolver,
		Outcome:  outcome,
	}

	// Validate through use cases
	if err := s.useCases.ResolveMarket(ctx, resolveReq); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to resolve market: %w", err))
	}

	// Create Solana transaction
	txResult, err := s.solanaClient.ResolveTx(ctx, resolveReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create transaction: %w", err))
	}

	s.logger.Info("market resolved", "market_id", req.Msg.MarketId, "outcome", outcome, "resolver", resolver)

	// Send notification
	if s.notifier != nil {
		go func() {
			market, err := s.useCases.GetMarket(context.Background(), req.Msg.MarketId)
			if err == nil {
				if err := s.notifier.NotifyMarketResolved(context.Background(), market); err != nil {
					s.logger.Error("failed to send market resolved notification", "error", err)
				}
			}
		}()
	}

	response := &ResolveResponse{
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// Claim claims winnings from a resolved market
func (s *BetsService) Claim(
	ctx context.Context,
	req *connect.Request[ClaimRequest],
) (*connect.Response[ClaimResponse], error) {
	// Extract owner from auth context
	owner, ok := ctx.Value("user_id").(string)
	if !ok || owner == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user authentication required"))
	}

	// Create domain request
	claimReq := &core.ClaimRequest{
		MarketID: req.Msg.MarketId,
		Owner:    owner,
	}

	// Get market and position to calculate payout
	market, err := s.useCases.GetMarket(ctx, req.Msg.MarketId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("market not found: %w", err))
	}

	positions, err := s.useCases.GetUserPositions(ctx, owner)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get user positions: %w", err))
	}

	// Find position for this market
	var position *core.Position
	for _, pos := range positions {
		if pos.MarketID == req.Msg.MarketId {
			position = pos
			break
		}
	}

	if position == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("no position found for market"))
	}

	// Calculate payout
	payoutInfo := market.CalculatePayout(position)

	// Create Solana transaction
	txResult, err := s.solanaClient.ClaimTx(ctx, claimReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create transaction: %w", err))
	}

	s.logger.Info("claim prepared", "market_id", req.Msg.MarketId, "owner", owner, "payout", payoutInfo.UserPayout)

	response := &ClaimResponse{
		PayoutAmount:     payoutInfo.UserPayout,
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// GetMarket gets a single market by ID
func (s *BetsService) GetMarket(
	ctx context.Context,
	req *connect.Request[GetMarketRequest],
) (*connect.Response[GetMarketResponse], error) {
	if req.Msg.MarketId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("market ID is required"))
	}

	// Get market from use cases
	market, err := s.useCases.GetMarket(ctx, req.Msg.MarketId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("market not found: %w", err))
	}

	response := &GetMarketResponse{
		Market: s.convertMarketToProto(market),
	}

	return connect.NewResponse(response), nil
}

// GetPosition gets a user's position in a specific market
func (s *BetsService) GetPosition(
	ctx context.Context,
	req *connect.Request[GetPositionRequest],
) (*connect.Response[GetPositionResponse], error) {
	if req.Msg.MarketId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("market ID is required"))
	}
	if req.Msg.Owner == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("owner is required"))
	}

	// Get position from use cases
	position, err := s.useCases.GetPosition(ctx, req.Msg.MarketId, req.Msg.Owner)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("position not found: %w", err))
	}

	response := &GetPositionResponse{
		Position: s.convertPositionToProto(position),
	}

	return connect.NewResponse(response), nil
}

// GetUserPositions gets all positions for a user
func (s *BetsService) GetUserPositions(
	ctx context.Context,
	req *connect.Request[GetUserPositionsRequest],
) (*connect.Response[GetUserPositionsResponse], error) {
	if req.Msg.Owner == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("owner is required"))
	}

	// Parse pagination
	limit := int(req.Msg.PageSize)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	// Parse page token to get offset
	offset := 0
	if req.Msg.PageToken != "" {
		if parsed, err := strconv.Atoi(req.Msg.PageToken); err == nil {
			offset = parsed
		}
	}

	// Get positions from use cases
	positions, err := s.useCases.GetUserPositionsWithPagination(ctx, req.Msg.Owner, limit, offset)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get user positions: %w", err))
	}

	// Convert to protobuf format
	pbPositions := make([]*Position, len(positions))
	for i, position := range positions {
		pbPositions[i] = s.convertPositionToProto(position)
	}

	// Generate next page token
	nextPageToken := ""
	if len(positions) == limit {
		nextPageToken = strconv.Itoa(offset + limit)
	}

	response := &GetUserPositionsResponse{
		Positions:     pbPositions,
		NextPageToken: nextPageToken,
	}

	return connect.NewResponse(response), nil
}

// WatchEvents streams market events
func (s *BetsService) WatchEvents(
	ctx context.Context,
	req *connect.Request[WatchEventsRequest],
	stream *connect.ServerStream[WatchEventsResponse],
) error {
	// Generate stream ID
	streamID := fmt.Sprintf("stream_%d", time.Now().UnixNano())

	// Create event channel for this stream
	eventChan := make(chan *MarketEvent, 100)

	// Register stream
	s.streamsMux.Lock()
	s.eventStreams[streamID] = eventChan
	s.streamsMux.Unlock()

	// Cleanup on exit
	defer func() {
		s.streamsMux.Lock()
		delete(s.eventStreams, streamID)
		close(eventChan)
		s.streamsMux.Unlock()
	}()

	s.logger.Info("event stream started", "stream_id", streamID, "market_count", len(req.Msg.MarketIds))

	// Stream events
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-eventChan:
			if !ok {
				return nil
			}

			// Filter by requested market IDs
			if len(req.Msg.MarketIds) > 0 {
				found := false
				for _, marketID := range req.Msg.MarketIds {
					if marketID == event.MarketID {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}

			// Send event to client
			response := &WatchEventsResponse{
				Event: &MarketEvent_{
					Id:          event.ID,
					MarketId:    event.MarketID,
					EventType:   event.EventType,
					Data:        event.Data,
					Timestamp:   event.Timestamp,
					TxSignature: event.TxSignature,
				},
			}

			if err := stream.Send(response); err != nil {
				s.logger.Error("failed to send event to stream", "error", err, "stream_id", streamID)
				return err
			}
		}
	}
}

// BroadcastEvent broadcasts an event to all active streams
func (s *BetsService) BroadcastEvent(event *MarketEvent) {
	s.streamsMux.RLock()
	defer s.streamsMux.RUnlock()

	for streamID, eventChan := range s.eventStreams {
		select {
		case eventChan <- event:
			// Event sent successfully
		default:
			// Channel is full, skip this stream
			s.logger.Warn("event channel full, dropping event", "stream_id", streamID)
		}
	}
}

// Helper methods

// convertMarketToProto converts a domain market to protobuf format
func (s *BetsService) convertMarketToProto(market *core.Market) *Market {
	pbMarket := &Market{
		Id:                  market.ID,
		Creator:             market.Creator,
		Mint:                market.Mint,
		Vault:               market.Vault,
		FeeBps:              uint32(market.FeeBps),
		EndTs:               market.EndTs.Unix(),
		ResolveDeadlineTs:   market.ResolveDeadlineTs.Unix(),
		StakedA:             market.StakedA,
		StakedB:             market.StakedB,
		CreatorFeeWithdrawn: market.CreatorFeeWithdrawn,
		Title:               market.Title,
		CreatedAt:           market.CreatedAt.Unix(),
	}

	// Convert status
	switch market.Status {
	case core.MarketStatusOpen:
		pbMarket.Status = MarketStatus_MARKET_STATUS_OPEN
	case core.MarketStatusPendingResolve:
		pbMarket.Status = MarketStatus_MARKET_STATUS_PENDING_RESOLVE
	case core.MarketStatusResolved:
		pbMarket.Status = MarketStatus_MARKET_STATUS_RESOLVED
	case core.MarketStatusCancelled:
		pbMarket.Status = MarketStatus_MARKET_STATUS_CANCELLED
	}

	// Convert outcome
	if market.Outcome != nil {
		switch *market.Outcome {
		case core.BetSideA:
			pbMarket.Outcome = Side_SIDE_A
		case core.BetSideB:
			pbMarket.Outcome = Side_SIDE_B
		}
	}

	return pbMarket
}

// convertPositionToProto converts a domain position to protobuf format
func (s *BetsService) convertPositionToProto(position *core.Position) *Position {
	pbPosition := &Position{
		Id:        position.ID,
		MarketId:  position.MarketID,
		Owner:     position.Owner,
		Amount:    position.Amount,
		Claimed:   position.Claimed,
		CreatedAt: 0, // Position doesn't have CreatedAt in domain model, so default to 0
	}

	// Convert side
	switch position.Side {
	case core.BetSideA:
		pbPosition.Side = Side_SIDE_A
	case core.BetSideB:
		pbPosition.Side = Side_SIDE_B
	}

	return pbPosition
}

// These types would normally be generated from protobuf files
// For now, I'll define them here as placeholders

type ListMarketsRequest struct {
	TitleFilter  string       `json:"title_filter"`
	StatusFilter MarketStatus `json:"status_filter"`
	PageSize     uint32       `json:"page_size"`
	PageToken    string       `json:"page_token"`
}

type ListMarketsResponse struct {
	Markets       []*Market `json:"markets"`
	NextPageToken string    `json:"next_page_token"`
}

type CreateMarketRequest struct {
	FeeBps            uint32 `json:"fee_bps"`
	EndTs             int64  `json:"end_ts"`
	ResolveDeadlineTs int64  `json:"resolve_deadline_ts"`
	Title             string `json:"title"`
	Creator           string `json:"creator"`
	Mint              string `json:"mint"`
}

type CreateMarketResponse struct {
	MarketId         string `json:"market_id"`
	UnsignedTxBase64 string `json:"unsigned_tx_base64"`
	Signature        string `json:"signature"`
}

type PlaceBetRequest struct {
	MarketId string `json:"market_id"`
	Owner    string `json:"owner"`
	Side     Side   `json:"side"`
	Amount   uint64 `json:"amount"`
}

type PlaceBetResponse struct {
	PositionId       string `json:"position_id"`
	UnsignedTxBase64 string `json:"unsigned_tx_base64"`
	Signature        string `json:"signature"`
}

type ResolveRequest struct {
	MarketId string `json:"market_id"`
	Resolver string `json:"resolver"`
	Outcome  Side   `json:"outcome"`
}

type ResolveResponse struct {
	UnsignedTxBase64 string `json:"unsigned_tx_base64"`
	Signature        string `json:"signature"`
}

type ClaimRequest struct {
	MarketId string `json:"market_id"`
	Owner    string `json:"owner"`
}

type ClaimResponse struct {
	PayoutAmount     uint64 `json:"payout_amount"`
	UnsignedTxBase64 string `json:"unsigned_tx_base64"`
	Signature        string `json:"signature"`
}

type WatchEventsRequest struct {
	MarketIds []string `json:"market_ids"`
}

type WatchEventsResponse struct {
	Event *MarketEvent_ `json:"event"`
}

type GetMarketRequest struct {
	MarketId string `json:"market_id"`
}

type GetMarketResponse struct {
	Market *Market `json:"market"`
}

type GetPositionRequest struct {
	MarketId string `json:"market_id"`
	Owner    string `json:"owner"`
}

type GetPositionResponse struct {
	Position *Position `json:"position"`
}

type GetUserPositionsRequest struct {
	Owner     string `json:"owner"`
	PageSize  uint32 `json:"page_size"`
	PageToken string `json:"page_token"`
}

type GetUserPositionsResponse struct {
	Positions     []*Position `json:"positions"`
	NextPageToken string      `json:"next_page_token"`
}

type Market struct {
	Id                  string       `json:"id"`
	Creator             string       `json:"creator"`
	Mint                string       `json:"mint"`
	Vault               string       `json:"vault"`
	FeeBps              uint32       `json:"fee_bps"`
	EndTs               int64        `json:"end_ts"`
	ResolveDeadlineTs   int64        `json:"resolve_deadline_ts"`
	StakedA             uint64       `json:"staked_a"`
	StakedB             uint64       `json:"staked_b"`
	Status              MarketStatus `json:"status"`
	Outcome             Side         `json:"outcome"`
	CreatorFeeWithdrawn bool         `json:"creator_fee_withdrawn"`
	Title               string       `json:"title"`
	CreatedAt           int64        `json:"created_at"`
}

type Position struct {
	Id        string `json:"id"`
	MarketId  string `json:"market_id"`
	Owner     string `json:"owner"`
	Side      Side   `json:"side"`
	Amount    uint64 `json:"amount"`
	Claimed   bool   `json:"claimed"`
	CreatedAt int64  `json:"created_at"`
}

type MarketEvent_ struct {
	Id          string `json:"id"`
	MarketId    string `json:"market_id"`
	EventType   string `json:"event_type"`
	Data        string `json:"data"`
	Timestamp   int64  `json:"timestamp"`
	TxSignature string `json:"tx_signature"`
}

type Side int32

const (
	Side_SIDE_UNSPECIFIED Side = 0
	Side_SIDE_A           Side = 1
	Side_SIDE_B           Side = 2
)

type MarketStatus int32

const (
	MarketStatus_MARKET_STATUS_UNSPECIFIED     MarketStatus = 0
	MarketStatus_MARKET_STATUS_OPEN            MarketStatus = 1
	MarketStatus_MARKET_STATUS_PENDING_RESOLVE MarketStatus = 2
	MarketStatus_MARKET_STATUS_RESOLVED        MarketStatus = 3
	MarketStatus_MARKET_STATUS_CANCELLED       MarketStatus = 4
)

// NewBetsServiceHandler creates Connect-Go handler (placeholder)
func NewBetsServiceHandler(service *BetsService, opts ...connect.HandlerOption) (string, http.Handler) {
	// This would normally be generated by Connect-Go from protobuf
	// For now, return placeholder values
	return "/bets.v1.BetsService/", nil
}

