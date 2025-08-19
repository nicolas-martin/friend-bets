package store

import (
	"time"

	"gorm.io/gorm"
)

// Repository provides database operations
type Repository struct {
	db *DB
}

// NewRepository creates a new repository
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// Markets

// GetMarket retrieves a market by ID
func (r *Repository) GetMarket(id string) (*MarketView, error) {
	var market MarketView
	err := r.db.First(&market, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &market, nil
}

// ListMarkets retrieves markets with filtering and pagination
func (r *Repository) ListMarkets(titleFilter, statusFilter string, limit, offset int) ([]MarketView, error) {
	var markets []MarketView
	query := r.db.Model(&MarketView{})

	if titleFilter != "" {
		query = query.Where("title ILIKE ?", "%"+titleFilter+"%")
	}
	if statusFilter != "" {
		query = query.Where("status = ?", statusFilter)
	}

	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&markets).Error
	return markets, err
}

// CreateMarket creates a new market
func (r *Repository) CreateMarket(market *MarketView) error {
	return r.db.Create(market).Error
}

// UpdateMarket updates an existing market
func (r *Repository) UpdateMarket(market *MarketView) error {
	return r.db.Save(market).Error
}

// GetMarketsByStatus gets markets by status
func (r *Repository) GetMarketsByStatus(status string) ([]MarketView, error) {
	var markets []MarketView
	err := r.db.Where("status = ?", status).Find(&markets).Error
	return markets, err
}

// GetMarketsNearEnd gets markets nearing their end time
func (r *Repository) GetMarketsNearEnd(within time.Duration) ([]MarketView, error) {
	var markets []MarketView
	cutoff := time.Now().Add(within)
	err := r.db.Where("status = ? AND end_ts <= ?", "open", cutoff).Find(&markets).Error
	return markets, err
}

// GetExpiredUnresolvedMarkets gets markets that are past their resolve deadline
func (r *Repository) GetExpiredUnresolvedMarkets() ([]MarketView, error) {
	var markets []MarketView
	now := time.Now()
	err := r.db.Where("status = ? AND resolve_deadline_ts < ?", "pending_resolve", now).Find(&markets).Error
	return markets, err
}

// Positions

// GetPosition retrieves a position by ID
func (r *Repository) GetPosition(id string) (*PositionView, error) {
	var position PositionView
	err := r.db.First(&position, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &position, nil
}

// GetUserPosition gets a user's position in a specific market
func (r *Repository) GetUserPosition(marketID, userID string) (*PositionView, error) {
	var position PositionView
	err := r.db.Where("market_id = ? AND owner = ?", marketID, userID).First(&position).Error
	if err != nil {
		return nil, err
	}
	return &position, nil
}

// CreateOrUpdatePosition creates a new position or updates an existing one
func (r *Repository) CreateOrUpdatePosition(position *PositionView) error {
	// Use GORM's upsert functionality
	return r.db.Save(position).Error
}

// GetPositionsByMarket gets all positions for a market
func (r *Repository) GetPositionsByMarket(marketID string) ([]PositionView, error) {
	var positions []PositionView
	err := r.db.Where("market_id = ?", marketID).Find(&positions).Error
	return positions, err
}

// GetPositionsByUser gets all positions for a user
func (r *Repository) GetPositionsByUser(userID string) ([]PositionView, error) {
	var positions []PositionView
	err := r.db.Preload("Market").Where("owner = ?", userID).Find(&positions).Error
	return positions, err
}

// Events

// CreateEventLog creates a new event log entry
func (r *Repository) CreateEventLog(event *EventLog) error {
	return r.db.Create(event).Error
}

// GetEventsByMarket gets events for a specific market
func (r *Repository) GetEventsByMarket(marketID string, limit int) ([]EventLog, error) {
	var events []EventLog
	err := r.db.Where("market_id = ?", marketID).Order("created_at DESC").Limit(limit).Find(&events).Error
	return events, err
}

// GetLatestProcessedSlot gets the latest processed slot from event logs
func (r *Repository) GetLatestProcessedSlot() (uint64, error) {
	var event EventLog
	err := r.db.Order("slot DESC").First(&event).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, nil // Start from beginning if no events
		}
		return 0, err
	}
	return event.Slot, nil
}

// Disputes

// CreateDispute creates a new dispute
func (r *Repository) CreateDispute(dispute *Dispute) error {
	return r.db.Create(dispute).Error
}

// GetDisputesByStatus gets disputes by status
func (r *Repository) GetDisputesByStatus(status string) ([]Dispute, error) {
	var disputes []Dispute
	err := r.db.Preload("Market").Where("status = ?", status).Find(&disputes).Error
	return disputes, err
}

// Notifications

// CreateNotificationSubscription creates a new notification subscription
func (r *Repository) CreateNotificationSubscription(sub *NotificationSubscription) error {
	return r.db.Create(sub).Error
}

// GetNotificationSubscriptions gets subscriptions for a user
func (r *Repository) GetNotificationSubscriptions(userID string) ([]NotificationSubscription, error) {
	var subs []NotificationSubscription
	err := r.db.Where("user_id = ? AND enabled = ?", userID, true).Find(&subs).Error
	return subs, err
}

// Analytics

// GetOrCreateAnalyticsDaily gets or creates daily analytics record
func (r *Repository) GetOrCreateAnalyticsDaily(date time.Time) (*AnalyticsDaily, error) {
	var analytics AnalyticsDaily
	err := r.db.Where("date = ?", date.Truncate(24*time.Hour)).FirstOrCreate(&analytics, AnalyticsDaily{
		Date: date.Truncate(24 * time.Hour),
	}).Error
	return &analytics, err
}

// UpdateAnalyticsDaily updates daily analytics
func (r *Repository) UpdateAnalyticsDaily(analytics *AnalyticsDaily) error {
	return r.db.Save(analytics).Error
}

// Rate Limiting

// IncrementRateCounter increments a rate counter
func (r *Repository) IncrementRateCounter(key string, windowDuration time.Duration) (int, error) {
	now := time.Now()
	windowEnd := now.Add(windowDuration)

	var counter RateCounter
	err := r.db.Where("key = ? AND window_end > ?", key, now).First(&counter).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new counter
			counter = RateCounter{
				Key:       key,
				Count:     1,
				WindowEnd: windowEnd,
			}
			err = r.db.Create(&counter).Error
			return counter.Count, err
		}
		return 0, err
	}

	// Increment existing counter
	counter.Count++
	err = r.db.Save(&counter).Error
	return counter.Count, err
}

// CleanupExpiredRateCounters removes expired rate counters
func (r *Repository) CleanupExpiredRateCounters() error {
	return r.db.Where("window_end < ?", time.Now()).Delete(&RateCounter{}).Error
}

// Health check
func (r *Repository) Health() error {
	return r.db.Health()
}

