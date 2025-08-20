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
	betsv1 "github.com/friend-bets/backend/gen/proto/bets/v1"
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
	eventStreams map[string]chan *betsv1.MarketEvent
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
		eventStreams: make(map[string]chan *betsv1.MarketEvent),
	}
}

// ListMarkets lists available markets
func (s *BetsService) ListMarkets(
	ctx context.Context,
	req *connect.Request[betsv1.ListMarketsRequest],
) (*connect.Response[betsv1.ListMarketsResponse], error) {
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
	case betsv1.MarketStatus_MARKET_STATUS_OPEN:
		statusFilter = core.MarketStatusOpen
	case betsv1.MarketStatus_MARKET_STATUS_PENDING_RESOLVE:
		statusFilter = core.MarketStatusPendingResolve
	case betsv1.MarketStatus_MARKET_STATUS_RESOLVED:
		statusFilter = core.MarketStatusResolved
	case betsv1.MarketStatus_MARKET_STATUS_CANCELLED:
		statusFilter = core.MarketStatusCancelled
	}

	// Get markets from use cases
	markets, err := s.useCases.ListMarkets(ctx, req.Msg.TitleFilter, statusFilter, limit, offset)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list markets: %w", err))
	}

	// Convert to protobuf format
	pbMarkets := make([]*betsv1.Market, len(markets))
	for i, market := range markets {
		pbMarkets[i] = s.convertMarketToProto(market)
	}

	// Generate next page token
	nextPageToken := ""
	if len(markets) == limit {
		nextPageToken = strconv.Itoa(offset + limit)
	}

	response := &betsv1.ListMarketsResponse{
		Markets:       pbMarkets,
		NextPageToken: nextPageToken,
	}

	return connect.NewResponse(response), nil
}

// CreateMarket creates a new betting market record after successful on-chain transaction
func (s *BetsService) CreateMarket(
	ctx context.Context,
	req *connect.Request[betsv1.CreateMarketRequest],
) (*connect.Response[betsv1.CreateMarketResponse], error) {
	// Extract creator from auth context (MVP: use dummy value if not authenticated)
	creator, ok := ctx.Value("user_id").(string)
	if !ok || creator == "" {
		// For MVP: use a default creator when auth is disabled
		creator = "mvp-user-" + req.Msg.Creator // Use creator from request for MVP
	}

	// Create domain request
	createReq := &core.CreateMarketRequest{
		Creator:           creator,
		Mint:              req.Msg.Mint,
		FeeBps:            uint16(req.Msg.FeeBps),
		EndTs:             time.Unix(req.Msg.EndTs, 0),
		ResolveDeadlineTs: time.Unix(req.Msg.ResolveDeadlineTs, 0),
		Title:             req.Msg.Title,
		MarketID:          req.Msg.MarketId, // Use on-chain PDA as market ID
	}

	// Create database record (transaction was already confirmed on-chain by frontend)
	market, err := s.useCases.CreateMarket(ctx, createReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to create market: %w", err))
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

	response := &betsv1.CreateMarketResponse{
		MarketId:         market.ID,
		UnsignedTxBase64: "", // Not used in frontend-only flow
		Signature:        "", // Not used in frontend-only flow
	}

	return connect.NewResponse(response), nil
}

// PlaceBet places a bet on a market
func (s *BetsService) PlaceBet(
	ctx context.Context,
	req *connect.Request[betsv1.PlaceBetRequest],
) (*connect.Response[betsv1.PlaceBetResponse], error) {
	// Extract owner from auth context (MVP: use dummy value if not authenticated)
	owner, ok := ctx.Value("user_id").(string)
	if !ok || owner == "" {
		// For MVP: use a default owner when auth is disabled
		owner = "mvp-user-" + req.Msg.Owner // Use owner from request for MVP
	}

	// Convert side
	var side string
	switch req.Msg.Side {
	case betsv1.Side_SIDE_A:
		side = core.BetSideA
	case betsv1.Side_SIDE_B:
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

	// Create database record (transaction was already confirmed on-chain by frontend)
	position, err := s.useCases.PlaceBet(ctx, betReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to place bet: %w", err))
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

	response := &betsv1.PlaceBetResponse{
		PositionId:       position.ID,
		UnsignedTxBase64: "", // Not used in frontend-only flow
		Signature:        "", // Not used in frontend-only flow
	}

	return connect.NewResponse(response), nil
}

// Resolve resolves a market outcome
func (s *BetsService) Resolve(
	ctx context.Context,
	req *connect.Request[betsv1.ResolveRequest],
) (*connect.Response[betsv1.ResolveResponse], error) {
	// Extract resolver from auth context (MVP: use dummy value if not authenticated)
	resolver, ok := ctx.Value("user_id").(string)
	if !ok || resolver == "" {
		// For MVP: use a default resolver when auth is disabled
		resolver = "mvp-user-" + req.Msg.Resolver // Use resolver from request for MVP
	}

	// Convert outcome
	var outcome string
	switch req.Msg.Outcome {
	case betsv1.Side_SIDE_A:
		outcome = core.BetSideA
	case betsv1.Side_SIDE_B:
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

	response := &betsv1.ResolveResponse{
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// Claim claims winnings from a resolved market
func (s *BetsService) Claim(
	ctx context.Context,
	req *connect.Request[betsv1.ClaimRequest],
) (*connect.Response[betsv1.ClaimResponse], error) {
	// Extract owner from auth context (MVP: use dummy value if not authenticated)
	owner, ok := ctx.Value("user_id").(string)
	if !ok || owner == "" {
		// For MVP: use a default owner when auth is disabled
		owner = "mvp-user-" + req.Msg.Owner // Use owner from request for MVP
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

	response := &betsv1.ClaimResponse{
		PayoutAmount:     payoutInfo.UserPayout,
		UnsignedTxBase64: txResult.UnsignedTxBase64,
		Signature:        txResult.Signature,
	}

	return connect.NewResponse(response), nil
}

// GetMarket gets a single market by ID
func (s *BetsService) GetMarket(
	ctx context.Context,
	req *connect.Request[betsv1.GetMarketRequest],
) (*connect.Response[betsv1.GetMarketResponse], error) {
	if req.Msg.MarketId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("market ID is required"))
	}

	// Get market from use cases
	market, err := s.useCases.GetMarket(ctx, req.Msg.MarketId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("market not found: %w", err))
	}

	response := &betsv1.GetMarketResponse{
		Market: s.convertMarketToProto(market),
	}

	return connect.NewResponse(response), nil
}

// GetPosition gets a user's position in a specific market
func (s *BetsService) GetPosition(
	ctx context.Context,
	req *connect.Request[betsv1.GetPositionRequest],
) (*connect.Response[betsv1.GetPositionResponse], error) {
	if req.Msg.MarketId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("market ID is required"))
	}
	if req.Msg.Owner == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("owner is required"))
	}

	// Get position from use cases
	owner := "mvp-user-" + req.Msg.Owner // Use owner from request for MVP
	position, err := s.useCases.GetPosition(ctx, req.Msg.MarketId, owner)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("position not found: %w", err))
	}

	response := &betsv1.GetPositionResponse{
		Position: s.convertPositionToProto(position),
	}

	return connect.NewResponse(response), nil
}

// GetUserPositions gets all positions for a user
func (s *BetsService) GetUserPositions(
	ctx context.Context,
	req *connect.Request[betsv1.GetUserPositionsRequest],
) (*connect.Response[betsv1.GetUserPositionsResponse], error) {
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
	owner := "mvp-user-" + req.Msg.Owner // Use owner from request for MVP
	positions, err := s.useCases.GetUserPositionsWithPagination(ctx, owner, limit, offset)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get user positions: %w", err))
	}

	// Convert to protobuf format
	pbPositions := make([]*betsv1.Position, len(positions))
	for i, position := range positions {
		pbPositions[i] = s.convertPositionToProto(position)
	}

	// Generate next page token
	nextPageToken := ""
	if len(positions) == limit {
		nextPageToken = strconv.Itoa(offset + limit)
	}

	response := &betsv1.GetUserPositionsResponse{
		Positions:     pbPositions,
		NextPageToken: nextPageToken,
	}

	return connect.NewResponse(response), nil
}

// WatchEvents streams market events
func (s *BetsService) WatchEvents(
	ctx context.Context,
	req *connect.Request[betsv1.WatchEventsRequest],
	stream *connect.ServerStream[betsv1.WatchEventsResponse],
) error {
	// Generate stream ID
	streamID := fmt.Sprintf("stream_%d", time.Now().UnixNano())

	// Create event channel for this stream
	eventChan := make(chan *betsv1.MarketEvent, 100)

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
					if marketID == event.MarketId {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}

			// Send event to client
			response := &betsv1.WatchEventsResponse{
				Event: &betsv1.MarketEvent{
					Id:          event.Id,
					MarketId:    event.MarketId,
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
		case eventChan <- &betsv1.MarketEvent{
			Id:          event.ID,
			MarketId:    event.MarketID,
			EventType:   event.EventType,
			Data:        event.Data,
			Timestamp:   event.Timestamp,
			TxSignature: event.TxSignature,
		}:
			// Event sent successfully
		default:
			// Channel is full, skip this stream
			s.logger.Warn("event channel full, dropping event", "stream_id", streamID)
		}
	}
}

// Helper methods

// convertMarketToProto converts a domain market to protobuf format
func (s *BetsService) convertMarketToProto(market *core.Market) *betsv1.Market {
	pbMarket := &betsv1.Market{
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
		pbMarket.Status = betsv1.MarketStatus_MARKET_STATUS_OPEN
	case core.MarketStatusPendingResolve:
		pbMarket.Status = betsv1.MarketStatus_MARKET_STATUS_PENDING_RESOLVE
	case core.MarketStatusResolved:
		pbMarket.Status = betsv1.MarketStatus_MARKET_STATUS_RESOLVED
	case core.MarketStatusCancelled:
		pbMarket.Status = betsv1.MarketStatus_MARKET_STATUS_CANCELLED
	}

	// Convert outcome
	if market.Outcome != nil {
		switch *market.Outcome {
		case core.BetSideA:
			pbMarket.Outcome = betsv1.Side_SIDE_A
		case core.BetSideB:
			pbMarket.Outcome = betsv1.Side_SIDE_B
		}
	}

	return pbMarket
}

// convertPositionToProto converts a domain position to protobuf format
func (s *BetsService) convertPositionToProto(position *core.Position) *betsv1.Position {
	pbPosition := &betsv1.Position{
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
		pbPosition.Side = betsv1.Side_SIDE_A
	case core.BetSideB:
		pbPosition.Side = betsv1.Side_SIDE_B
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
