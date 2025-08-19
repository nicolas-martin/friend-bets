package store

import (
	"time"

	"gorm.io/gorm"
)

// MarketView represents a market in the database (shadow of on-chain state)
type MarketView struct {
	ID                  string    `gorm:"primaryKey" json:"id"`
	Creator             string    `gorm:"not null;index" json:"creator"`
	Mint                string    `gorm:"not null" json:"mint"`
	Vault               string    `gorm:"not null" json:"vault"`
	FeeBps              uint16    `gorm:"not null" json:"fee_bps"`
	EndTs               time.Time `gorm:"not null;index" json:"end_ts"`
	ResolveDeadlineTs   time.Time `gorm:"not null;index" json:"resolve_deadline_ts"`
	StakedA             uint64    `gorm:"not null;default:0" json:"staked_a"`
	StakedB             uint64    `gorm:"not null;default:0" json:"staked_b"`
	Status              string    `gorm:"not null;default:'open';index" json:"status"` // open, pending_resolve, resolved, cancelled
	Outcome             *string   `json:"outcome,omitempty"`                           // A or B
	CreatorFeeWithdrawn bool      `gorm:"not null;default:false" json:"creator_fee_withdrawn"`
	Title               string    `gorm:"not null" json:"title"`
	CreatedAt           time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Derived fields
	TotalStaked uint64  `gorm:"->" json:"total_staked"`
	OddsA       float64 `gorm:"->" json:"odds_a"`
	OddsB       float64 `gorm:"->" json:"odds_b"`

	// Relations
	Positions []PositionView `gorm:"foreignKey:MarketID" json:"positions,omitempty"`
}

// PositionView represents a user's position in a market
type PositionView struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	MarketID  string    `gorm:"not null;index" json:"market_id"`
	Owner     string    `gorm:"not null;index" json:"owner"`
	Side      string    `gorm:"not null" json:"side"` // A or B
	Amount    uint64    `gorm:"not null" json:"amount"`
	Claimed   bool      `gorm:"not null;default:false" json:"claimed"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relations
	Market MarketView `gorm:"foreignKey:MarketID" json:"market,omitempty"`
}

// EventLog stores blockchain events for indexing
type EventLog struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	TxSignature string    `gorm:"not null;index" json:"tx_signature"`
	EventType   string    `gorm:"not null;index" json:"event_type"`
	MarketID    *string   `gorm:"index" json:"market_id,omitempty"`
	UserID      *string   `gorm:"index" json:"user_id,omitempty"`
	Data        string    `gorm:"type:jsonb" json:"data"` // JSON-encoded event data
	Slot        uint64    `gorm:"not null;index" json:"slot"`
	BlockTime   time.Time `gorm:"not null" json:"block_time"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Dispute represents a dispute for manual resolution
type Dispute struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	MarketID    string    `gorm:"not null;index" json:"market_id"`
	DisputerID  string    `gorm:"not null" json:"disputer_id"`
	Reason      string    `gorm:"not null" json:"reason"`
	EvidenceURL string    `json:"evidence_url,omitempty"`
	Status      string    `gorm:"not null;default:'pending'" json:"status"` // pending, reviewing, resolved, rejected
	AdminNotes  string    `json:"admin_notes,omitempty"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relations
	Market MarketView `gorm:"foreignKey:MarketID" json:"market,omitempty"`
}

// NotificationSubscription stores user notification preferences
type NotificationSubscription struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    string    `gorm:"not null;index" json:"user_id"`
	Type      string    `gorm:"not null" json:"type"` // email, web_push
	Endpoint  string    `gorm:"not null" json:"endpoint"`
	Data      string    `gorm:"type:jsonb" json:"data"` // JSON for web push keys, etc.
	Enabled   bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AnalyticsDaily stores daily rolled-up analytics
type AnalyticsDaily struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Date            time.Time `gorm:"not null;uniqueIndex" json:"date"`
	MarketsCreated  int       `gorm:"not null;default:0" json:"markets_created"`
	BetsPlaced      int       `gorm:"not null;default:0" json:"bets_placed"`
	MarketsResolved int       `gorm:"not null;default:0" json:"markets_resolved"`
	TotalVolume     uint64    `gorm:"not null;default:0" json:"total_volume"`
	ActiveUsers     int       `gorm:"not null;default:0" json:"active_users"`
	CreatedAt       time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// RateCounter stores rate limiting counters
type RateCounter struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"not null;uniqueIndex" json:"key"` // user_id:action or ip:action
	Count     int       `gorm:"not null;default:0" json:"count"`
	WindowEnd time.Time `gorm:"not null;index" json:"window_end"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AutoMigrate runs database migrations
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&MarketView{},
		&PositionView{},
		&EventLog{},
		&Dispute{},
		&NotificationSubscription{},
		&AnalyticsDaily{},
		&RateCounter{},
	)
}

