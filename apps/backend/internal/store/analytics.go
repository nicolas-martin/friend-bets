package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// Odds represents betting odds
type Odds struct {
	A float64 `json:"a"`
	B float64 `json:"b"`
}

// Analytics provides analytics and metrics functionality
type Analytics struct {
	repo   *Repository
	logger *slog.Logger
}

// NewAnalytics creates a new analytics service
func NewAnalytics(repo *Repository, logger *slog.Logger) *Analytics {
	return &Analytics{
		repo:   repo,
		logger: logger,
	}
}

// Market Analytics

// MarketMetrics contains metrics for a specific market
type MarketMetrics struct {
	MarketID           string     `json:"market_id"`
	Title              string     `json:"title"`
	Creator            string     `json:"creator"`
	CreatedAt          time.Time  `json:"created_at"`
	TotalVolume        uint64     `json:"total_volume"`
	TotalBets          int        `json:"total_bets"`
	UniqueParticipants int        `json:"unique_participants"`
	SideAVolume        uint64     `json:"side_a_volume"`
	SideBVolume        uint64     `json:"side_b_volume"`
	SideABets          int        `json:"side_a_bets"`
	SideBBets          int        `json:"side_b_bets"`
	CurrentOdds        Odds  `json:"current_odds"`
	Status             string     `json:"status"`
	ResolvedAt         *time.Time `json:"resolved_at,omitempty"`
	Outcome            *string    `json:"outcome,omitempty"`
}

// DailyMetrics contains daily aggregated metrics
type DailyMetrics struct {
	Date               time.Time `json:"date"`
	MarketsCreated     int       `json:"markets_created"`
	BetsPlaced         int       `json:"bets_placed"`
	MarketsResolved    int       `json:"markets_resolved"`
	TotalVolume        uint64    `json:"total_volume"`
	ActiveUsers        int       `json:"active_users"`
	NewUsers           int       `json:"new_users"`
	AvgBetSize         float64   `json:"avg_bet_size"`
	LargestBet         uint64    `json:"largest_bet"`
	MostActiveMarket   string    `json:"most_active_market"`
	TopCreatorByVolume string    `json:"top_creator_by_volume"`
}

// UserMetrics contains metrics for a specific user
type UserMetrics struct {
	UserID         string    `json:"user_id"`
	TotalBets      int       `json:"total_bets"`
	TotalVolume    uint64    `json:"total_volume"`
	MarketsCreated int       `json:"markets_created"`
	WinningBets    int       `json:"winning_bets"`
	LosingBets     int       `json:"losing_bets"`
	WinRate        float64   `json:"win_rate"`
	ProfitLoss     int64     `json:"profit_loss"`
	AvgBetSize     float64   `json:"avg_bet_size"`
	LargestBet     uint64    `json:"largest_bet"`
	FavoredSide    string    `json:"favored_side"` // Which side they bet on more often
	FirstBetAt     time.Time `json:"first_bet_at"`
	LastBetAt      time.Time `json:"last_bet_at"`
	ActiveDays     int       `json:"active_days"`
}

// FunnelMetrics contains conversion funnel metrics
type FunnelMetrics struct {
	Date                 time.Time `json:"date"`
	VisitorsToApp        int       `json:"visitors_to_app"`
	ViewedMarkets        int       `json:"viewed_markets"`
	ConnectedWallet      int       `json:"connected_wallet"`
	PlacedFirstBet       int       `json:"placed_first_bet"`
	ReturnedUsers        int       `json:"returned_users"`
	ConversionToFirstBet float64   `json:"conversion_to_first_bet"`
	RetentionRate        float64   `json:"retention_rate"`
}

// GetMarketMetrics retrieves comprehensive metrics for a market
func (a *Analytics) GetMarketMetrics(ctx context.Context, marketID string) (*MarketMetrics, error) {
	// Get market details
	market, err := a.repo.GetMarket(marketID)
	if err != nil {
		return nil, fmt.Errorf("failed to get market: %w", err)
	}

	// Get all positions for this market
	positions, err := a.repo.GetPositionsByMarket(marketID)
	if err != nil {
		return nil, fmt.Errorf("failed to get positions: %w", err)
	}

	// Calculate metrics
	metrics := &MarketMetrics{
		MarketID:  market.ID,
		Title:     market.Title,
		Creator:   market.Creator,
		CreatedAt: market.CreatedAt,
		Status:    market.Status,
		Outcome:   market.Outcome,
	}

	// Calculate position metrics
	uniqueUsers := make(map[string]bool)
	for _, pos := range positions {
		metrics.TotalBets++
		metrics.TotalVolume += pos.Amount
		uniqueUsers[pos.Owner] = true

		if pos.Side == "A" {
			metrics.SideABets++
			metrics.SideAVolume += pos.Amount
		} else {
			metrics.SideBBets++
			metrics.SideBVolume += pos.Amount
		}
	}

	metrics.UniqueParticipants = len(uniqueUsers)

	// Calculate current odds
	if market.StakedA+market.StakedB > 0 {
		totalStaked := float64(market.StakedA + market.StakedB)
		metrics.CurrentOdds = Odds{
			A: totalStaked / float64(market.StakedA),
			B: totalStaked / float64(market.StakedB),
		}
	} else {
		metrics.CurrentOdds = Odds{A: 1.0, B: 1.0}
	}

	// Set resolved timestamp if resolved
	if market.Status == "resolved" {
		metrics.ResolvedAt = &market.UpdatedAt
	}

	return metrics, nil
}

// GetDailyMetrics retrieves daily aggregated metrics
func (a *Analytics) GetDailyMetrics(ctx context.Context, date time.Time) (*DailyMetrics, error) {
	startOfDay := date.Truncate(24 * time.Hour)
	endOfDay := startOfDay.Add(24 * time.Hour)

	metrics := &DailyMetrics{
		Date: startOfDay,
	}

	// Get daily analytics record if it exists
	analytics, err := a.repo.GetOrCreateAnalyticsDaily(startOfDay)
	if err != nil {
		return nil, fmt.Errorf("failed to get daily analytics: %w", err)
	}

	// Use stored values
	metrics.MarketsCreated = analytics.MarketsCreated
	metrics.BetsPlaced = analytics.BetsPlaced
	metrics.MarketsResolved = analytics.MarketsResolved
	metrics.TotalVolume = analytics.TotalVolume
	metrics.ActiveUsers = analytics.ActiveUsers

	// Calculate additional metrics if needed
	if err := a.calculateAdditionalDailyMetrics(ctx, metrics, startOfDay, endOfDay); err != nil {
		a.logger.Error("failed to calculate additional daily metrics", "error", err)
	}

	return metrics, nil
}

// calculateAdditionalDailyMetrics calculates additional metrics not stored in daily rollup
func (a *Analytics) calculateAdditionalDailyMetrics(ctx context.Context, metrics *DailyMetrics, startOfDay, endOfDay time.Time) error {
	db := a.repo.db.DB

	// Calculate average bet size
	var avgBetSize sql.NullFloat64
	err := db.Model(&PositionView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Select("AVG(amount)").
		Scan(&avgBetSize).Error
	if err != nil {
		return fmt.Errorf("failed to calculate avg bet size: %w", err)
	}
	metrics.AvgBetSize = avgBetSize.Float64

	// Calculate largest bet
	var largestBet uint64
	err = db.Model(&PositionView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Select("MAX(amount)").
		Scan(&largestBet).Error
	if err != nil {
		return fmt.Errorf("failed to calculate largest bet: %w", err)
	}
	metrics.LargestBet = largestBet

	// Find most active market by bet count
	var mostActiveMarket struct {
		MarketID string
		BetCount int
	}
	err = db.Model(&PositionView{}).
		Select("market_id, COUNT(*) as bet_count").
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Group("market_id").
		Order("bet_count DESC").
		Limit(1).
		Scan(&mostActiveMarket).Error
	if err == nil {
		metrics.MostActiveMarket = mostActiveMarket.MarketID
	}

	// Find top creator by volume
	var topCreator struct {
		Creator string
		Volume  uint64
	}
	err = db.Table("market_views m").
		Select("m.creator, SUM(p.amount) as volume").
		Joins("JOIN position_views p ON p.market_id = m.id").
		Where("p.created_at >= ? AND p.created_at < ?", startOfDay, endOfDay).
		Group("m.creator").
		Order("volume DESC").
		Limit(1).
		Scan(&topCreator).Error
	if err == nil {
		metrics.TopCreatorByVolume = topCreator.Creator
	}

	return nil
}

// GetUserMetrics retrieves comprehensive metrics for a user
func (a *Analytics) GetUserMetrics(ctx context.Context, userID string) (*UserMetrics, error) {
	db := a.repo.db.DB

	metrics := &UserMetrics{
		UserID: userID,
	}

	// Get user positions
	positions, err := a.repo.GetPositionsByUser(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user positions: %w", err)
	}

	// Count markets created by user
	var marketsCreated int64
	err = db.Model(&MarketView{}).Where("creator = ?", userID).Count(&marketsCreated).Error
	if err != nil {
		return nil, fmt.Errorf("failed to count markets created: %w", err)
	}
	metrics.MarketsCreated = int(marketsCreated)

	// Process positions
	if len(positions) > 0 {
		metrics.TotalBets = len(positions)

		var totalVolume uint64
		var largestBet uint64
		sideACounts := 0
		firstBetTime := positions[0].CreatedAt
		lastBetTime := positions[0].CreatedAt
		activeDaysMap := make(map[string]bool)

		for _, pos := range positions {
			totalVolume += pos.Amount
			if pos.Amount > largestBet {
				largestBet = pos.Amount
			}

			if pos.Side == "A" {
				sideACounts++
			}

			if pos.CreatedAt.Before(firstBetTime) {
				firstBetTime = pos.CreatedAt
			}
			if pos.CreatedAt.After(lastBetTime) {
				lastBetTime = pos.CreatedAt
			}

			// Track unique active days
			dayKey := pos.CreatedAt.Format("2006-01-02")
			activeDaysMap[dayKey] = true

			// Check if position won (need to get market outcome)
			market, err := a.repo.GetMarket(pos.MarketID)
			if err == nil && market.Status == "resolved" && market.Outcome != nil {
				if *market.Outcome == pos.Side {
					metrics.WinningBets++
				} else {
					metrics.LosingBets++
				}
			}
		}

		metrics.TotalVolume = totalVolume
		metrics.LargestBet = largestBet
		metrics.AvgBetSize = float64(totalVolume) / float64(metrics.TotalBets)
		metrics.FirstBetAt = firstBetTime
		metrics.LastBetAt = lastBetTime
		metrics.ActiveDays = len(activeDaysMap)

		// Calculate win rate
		totalResolvedBets := metrics.WinningBets + metrics.LosingBets
		if totalResolvedBets > 0 {
			metrics.WinRate = float64(metrics.WinningBets) / float64(totalResolvedBets) * 100
		}

		// Determine favored side
		if sideACounts > len(positions)/2 {
			metrics.FavoredSide = "A"
		} else if sideACounts < len(positions)/2 {
			metrics.FavoredSide = "B"
		} else {
			metrics.FavoredSide = "balanced"
		}
	}

	return metrics, nil
}

// ProcessDailyRollup processes and stores daily analytics rollup
func (a *Analytics) ProcessDailyRollup(ctx context.Context, date time.Time) error {
	startOfDay := date.Truncate(24 * time.Hour)
	endOfDay := startOfDay.Add(24 * time.Hour)

	a.logger.Info("processing daily rollup", "date", startOfDay.Format("2006-01-02"))

	// Get or create daily analytics record
	analytics, err := a.repo.GetOrCreateAnalyticsDaily(startOfDay)
	if err != nil {
		return fmt.Errorf("failed to get analytics record: %w", err)
	}

	db := a.repo.db.DB

	// Count markets created
	var marketsCreated int64
	err = db.Model(&MarketView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Count(&marketsCreated).Error
	if err != nil {
		return fmt.Errorf("failed to count markets created: %w", err)
	}
	analytics.MarketsCreated = int(marketsCreated)

	// Count bets placed
	var betsPlaced int64
	err = db.Model(&PositionView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Count(&betsPlaced).Error
	if err != nil {
		return fmt.Errorf("failed to count bets placed: %w", err)
	}
	analytics.BetsPlaced = int(betsPlaced)

	// Count markets resolved
	var marketsResolved int64
	err = db.Model(&MarketView{}).
		Where("updated_at >= ? AND updated_at < ? AND status = ?", startOfDay, endOfDay, "resolved").
		Count(&marketsResolved).Error
	if err != nil {
		return fmt.Errorf("failed to count markets resolved: %w", err)
	}
	analytics.MarketsResolved = int(marketsResolved)

	// Calculate total volume
	var totalVolume sql.NullFloat64
	err = db.Model(&PositionView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Select("SUM(amount)").
		Scan(&totalVolume).Error
	if err != nil {
		return fmt.Errorf("failed to calculate total volume: %w", err)
	}
	if totalVolume.Valid {
		analytics.TotalVolume = uint64(totalVolume.Float64)
	}

	// Count active users (users who placed bets)
	var activeUsers int64
	err = db.Model(&PositionView{}).
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).
		Distinct("owner").
		Count(&activeUsers).Error
	if err != nil {
		return fmt.Errorf("failed to count active users: %w", err)
	}
	analytics.ActiveUsers = int(activeUsers)

	// Update analytics record
	if err := a.repo.UpdateAnalyticsDaily(analytics); err != nil {
		return fmt.Errorf("failed to update analytics: %w", err)
	}

	a.logger.Info("daily rollup completed",
		"date", startOfDay.Format("2006-01-02"),
		"markets_created", analytics.MarketsCreated,
		"bets_placed", analytics.BetsPlaced,
		"total_volume", analytics.TotalVolume,
		"active_users", analytics.ActiveUsers,
	)

	return nil
}

// GetPlatformOverview returns high-level platform metrics
func (a *Analytics) GetPlatformOverview(ctx context.Context) (map[string]interface{}, error) {
	db := a.repo.db.DB

	overview := make(map[string]interface{})

	// Total markets
	var totalMarkets int64
	db.Model(&MarketView{}).Count(&totalMarkets)
	overview["total_markets"] = totalMarkets

	// Total bets
	var totalBets int64
	db.Model(&PositionView{}).Count(&totalBets)
	overview["total_bets"] = totalBets

	// Total volume
	var totalVolume sql.NullFloat64
	db.Model(&PositionView{}).Select("SUM(amount)").Scan(&totalVolume)
	if totalVolume.Valid {
		overview["total_volume"] = uint64(totalVolume.Float64)
	} else {
		overview["total_volume"] = uint64(0)
	}

	// Active markets
	var activeMarkets int64
	db.Model(&MarketView{}).Where("status = ?", "open").Count(&activeMarkets)
	overview["active_markets"] = activeMarkets

	// Unique users
	var uniqueUsers int64
	db.Model(&PositionView{}).Distinct("owner").Count(&uniqueUsers)
	overview["unique_users"] = uniqueUsers

	// Recent activity (last 24 hours)
	last24h := time.Now().Add(-24 * time.Hour)

	var recentBets int64
	db.Model(&PositionView{}).Where("created_at > ?", last24h).Count(&recentBets)
	overview["recent_bets_24h"] = recentBets

	var recentVolume sql.NullFloat64
	db.Model(&PositionView{}).Where("created_at > ?", last24h).Select("SUM(amount)").Scan(&recentVolume)
	if recentVolume.Valid {
		overview["recent_volume_24h"] = uint64(recentVolume.Float64)
	} else {
		overview["recent_volume_24h"] = uint64(0)
	}

	return overview, nil
}

// GetTopMarketsByVolume returns top markets by trading volume
func (a *Analytics) GetTopMarketsByVolume(ctx context.Context, limit int) ([]MarketMetrics, error) {
	db := a.repo.db.DB

	var results []struct {
		MarketID    string
		Title       string
		Creator     string
		CreatedAt   time.Time
		TotalVolume uint64
		TotalBets   int64
	}

	err := db.Table("market_views m").
		Select("m.id as market_id, m.title, m.creator, m.created_at, COALESCE(SUM(p.amount), 0) as total_volume, COUNT(p.id) as total_bets").
		Joins("LEFT JOIN position_views p ON p.market_id = m.id").
		Group("m.id, m.title, m.creator, m.created_at").
		Order("total_volume DESC").
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get top markets: %w", err)
	}

	metrics := make([]MarketMetrics, len(results))
	for i, result := range results {
		metrics[i] = MarketMetrics{
			MarketID:    result.MarketID,
			Title:       result.Title,
			Creator:     result.Creator,
			CreatedAt:   result.CreatedAt,
			TotalVolume: result.TotalVolume,
			TotalBets:   int(result.TotalBets),
		}
	}

	return metrics, nil
}

// GetTopUsersByVolume returns top users by trading volume
func (a *Analytics) GetTopUsersByVolume(ctx context.Context, limit int) ([]UserMetrics, error) {
	db := a.repo.db.DB

	var results []struct {
		UserID      string
		TotalVolume uint64
		TotalBets   int64
		FirstBetAt  time.Time
		LastBetAt   time.Time
	}

	err := db.Model(&PositionView{}).
		Select("owner as user_id, SUM(amount) as total_volume, COUNT(*) as total_bets, MIN(created_at) as first_bet_at, MAX(created_at) as last_bet_at").
		Group("owner").
		Order("total_volume DESC").
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get top users: %w", err)
	}

	metrics := make([]UserMetrics, len(results))
	for i, result := range results {
		metrics[i] = UserMetrics{
			UserID:      result.UserID,
			TotalVolume: result.TotalVolume,
			TotalBets:   int(result.TotalBets),
			FirstBetAt:  result.FirstBetAt,
			LastBetAt:   result.LastBetAt,
			AvgBetSize:  float64(result.TotalVolume) / float64(result.TotalBets),
		}
	}

	return metrics, nil
}

// TrackFunnelEvent tracks a funnel conversion event
func (a *Analytics) TrackFunnelEvent(ctx context.Context, eventType, userID string, metadata map[string]interface{}) error {
	// This would typically track events in a separate analytics table
	// For now, just log the event
	a.logger.Info("funnel event tracked",
		"event_type", eventType,
		"user_id", userID,
		"metadata", metadata,
	)
	return nil
}

// GetFunnelMetrics retrieves conversion funnel metrics
func (a *Analytics) GetFunnelMetrics(ctx context.Context, date time.Time) (*FunnelMetrics, error) {
	// This would need to be implemented based on tracked funnel events
	// For now, return basic metrics
	return &FunnelMetrics{
		Date:                 date,
		ConversionToFirstBet: 15.0, // Example: 15% conversion rate
		RetentionRate:        30.0, // Example: 30% retention rate
	}, nil
}

// Health check
func (a *Analytics) Health() error {
	return a.repo.Health()
}

