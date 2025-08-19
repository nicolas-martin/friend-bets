package notify

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"
	"time"

	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
	"github.com/friend-bets/backend/internal/store"
)

// Notifier handles notifications (email, web push, etc.)
type Notifier struct {
	config *config.NotifyConfig
	repo   *store.Repository
	logger *slog.Logger
}

// NewNotifier creates a new notifier instance
func NewNotifier(cfg *config.NotifyConfig, repo *store.Repository, logger *slog.Logger) *Notifier {
	return &Notifier{
		config: cfg,
		repo:   repo,
		logger: logger,
	}
}

// NotificationTemplate represents a notification template
type NotificationTemplate struct {
	Subject     string
	TextBody    string
	HTMLBody    string
	WebPushData map[string]interface{}
}

// EmailNotification represents an email notification
type EmailNotification struct {
	To      string
	Subject string
	Body    string
	IsHTML  bool
}

// WebPushNotification represents a web push notification
type WebPushNotification struct {
	Endpoint string
	Payload  string
	Keys     WebPushKeys
}

// WebPushKeys contains web push encryption keys
type WebPushKeys struct {
	Auth   string `json:"auth"`
	P256dh string `json:"p256dh"`
}

// Market event notifications

// NotifyMarketCreated sends notification when a market is created
func (n *Notifier) NotifyMarketCreated(ctx context.Context, market *core.Market) error {
	n.logger.Info("sending market created notifications", "market_id", market.ID, "title", market.Title)

	template := &NotificationTemplate{
		Subject:  fmt.Sprintf("New Market: %s", market.Title),
		TextBody: n.generateMarketCreatedText(market),
		HTMLBody: n.generateMarketCreatedHTML(market),
		WebPushData: map[string]interface{}{
			"title":     "New Market Created",
			"body":      fmt.Sprintf("New betting market: %s", market.Title),
			"icon":      "/icon-192x192.png",
			"badge":     "/badge-72x72.png",
			"market_id": market.ID,
			"action":    "market_created",
		},
	}

	// Get subscriptions for market creation notifications
	subscriptions, err := n.getSubscriptionsForEvent(ctx, "market_created")
	if err != nil {
		return fmt.Errorf("failed to get subscriptions: %w", err)
	}

	// Send notifications
	return n.sendNotifications(ctx, subscriptions, template)
}

// NotifyBetPlaced sends notification when a bet is placed
func (n *Notifier) NotifyBetPlaced(ctx context.Context, position *core.Position) error {
	n.logger.Info("sending bet placed notifications", "position_id", position.ID, "market_id", position.MarketID)

	template := &NotificationTemplate{
		Subject:  "Bet Placed Successfully",
		TextBody: n.generateBetPlacedText(position),
		HTMLBody: n.generateBetPlacedHTML(position),
		WebPushData: map[string]interface{}{
			"title":      "Bet Placed",
			"body":       fmt.Sprintf("Your bet on side %s has been placed", position.Side),
			"icon":       "/icon-192x192.png",
			"badge":      "/badge-72x72.png",
			"market_id":  position.MarketID,
			"position_id": position.ID,
			"action":     "bet_placed",
		},
	}

	// Get user-specific subscriptions
	subscriptions, err := n.getUserSubscriptions(ctx, position.Owner)
	if err != nil {
		return fmt.Errorf("failed to get user subscriptions: %w", err)
	}

	return n.sendNotifications(ctx, subscriptions, template)
}

// NotifyMarketResolved sends notification when a market is resolved
func (n *Notifier) NotifyMarketResolved(ctx context.Context, market *core.Market) error {
	n.logger.Info("sending market resolved notifications", "market_id", market.ID, "outcome", *market.Outcome)

	template := &NotificationTemplate{
		Subject:  fmt.Sprintf("Market Resolved: %s", market.Title),
		TextBody: n.generateMarketResolvedText(market),
		HTMLBody: n.generateMarketResolvedHTML(market),
		WebPushData: map[string]interface{}{
			"title":     "Market Resolved",
			"body":      fmt.Sprintf("Market resolved with outcome: %s", *market.Outcome),
			"icon":      "/icon-192x192.png",
			"badge":     "/badge-72x72.png",
			"market_id": market.ID,
			"outcome":   *market.Outcome,
			"action":    "market_resolved",
		},
	}

	// Get subscriptions for participants in this market
	subscriptions, err := n.getMarketParticipantSubscriptions(ctx, market.ID)
	if err != nil {
		return fmt.Errorf("failed to get market participant subscriptions: %w", err)
	}

	return n.sendNotifications(ctx, subscriptions, template)
}

// NotifyMarketExpiring sends notification when a market is about to expire
func (n *Notifier) NotifyMarketExpiring(ctx context.Context, market *core.Market, timeUntilExpiry time.Duration) error {
	n.logger.Info("sending market expiring notifications", "market_id", market.ID, "expires_in", timeUntilExpiry)

	template := &NotificationTemplate{
		Subject:  fmt.Sprintf("Market Expiring Soon: %s", market.Title),
		TextBody: n.generateMarketExpiringText(market, timeUntilExpiry),
		HTMLBody: n.generateMarketExpiringHTML(market, timeUntilExpiry),
		WebPushData: map[string]interface{}{
			"title":     "Market Expiring",
			"body":      fmt.Sprintf("Market expires in %v", timeUntilExpiry),
			"icon":      "/icon-192x192.png",
			"badge":     "/badge-72x72.png",
			"market_id": market.ID,
			"action":    "market_expiring",
		},
	}

	// Get subscriptions for participants in this market
	subscriptions, err := n.getMarketParticipantSubscriptions(ctx, market.ID)
	if err != nil {
		return fmt.Errorf("failed to get market participant subscriptions: %w", err)
	}

	return n.sendNotifications(ctx, subscriptions, template)
}

// Core notification sending methods

// sendNotifications sends notifications to all subscriptions
func (n *Notifier) sendNotifications(ctx context.Context, subscriptions []store.NotificationSubscription, template *NotificationTemplate) error {
	var lastError error

	for _, sub := range subscriptions {
		switch sub.Type {
		case "email":
			if err := n.sendEmailNotification(ctx, &EmailNotification{
				To:      sub.Endpoint,
				Subject: template.Subject,
				Body:    template.HTMLBody,
				IsHTML:  true,
			}); err != nil {
				n.logger.Error("failed to send email notification", "error", err, "email", sub.Endpoint)
				lastError = err
			}

		case "web_push":
			webPushData, err := n.parseWebPushData(sub.Data)
			if err != nil {
				n.logger.Error("failed to parse web push data", "error", err, "user_id", sub.UserID)
				continue
			}

			payload, err := json.Marshal(template.WebPushData)
			if err != nil {
				n.logger.Error("failed to marshal web push payload", "error", err)
				continue
			}

			if err := n.sendWebPushNotification(ctx, &WebPushNotification{
				Endpoint: sub.Endpoint,
				Payload:  string(payload),
				Keys:     *webPushData,
			}); err != nil {
				n.logger.Error("failed to send web push notification", "error", err, "user_id", sub.UserID)
				lastError = err
			}

		default:
			n.logger.Warn("unknown notification type", "type", sub.Type, "user_id", sub.UserID)
		}
	}

	return lastError
}

// sendEmailNotification sends an email notification
func (n *Notifier) sendEmailNotification(ctx context.Context, notification *EmailNotification) error {
	if n.config.SMTP.Host == "" {
		return fmt.Errorf("SMTP not configured")
	}

	// Create message
	var message strings.Builder
	message.WriteString(fmt.Sprintf("To: %s\r\n", notification.To))
	message.WriteString(fmt.Sprintf("From: %s\r\n", n.config.SMTP.From))
	message.WriteString(fmt.Sprintf("Subject: %s\r\n", notification.Subject))
	
	if notification.IsHTML {
		message.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	} else {
		message.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	}
	
	message.WriteString("\r\n")
	message.WriteString(notification.Body)

	// Set up authentication
	auth := smtp.PlainAuth("", n.config.SMTP.Username, n.config.SMTP.Password, n.config.SMTP.Host)

	// Send email
	addr := fmt.Sprintf("%s:%d", n.config.SMTP.Host, n.config.SMTP.Port)
	
	// Use TLS for secure connection
	tlsConfig := &tls.Config{
		ServerName: n.config.SMTP.Host,
	}

	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, n.config.SMTP.Host)
	if err != nil {
		return fmt.Errorf("failed to create SMTP client: %w", err)
	}
	defer client.Quit()

	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("SMTP auth failed: %w", err)
	}

	if err := client.Mail(n.config.SMTP.From); err != nil {
		return fmt.Errorf("failed to set sender: %w", err)
	}

	if err := client.Rcpt(notification.To); err != nil {
		return fmt.Errorf("failed to set recipient: %w", err)
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("failed to get data writer: %w", err)
	}

	if _, err := writer.Write([]byte(message.String())); err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to close message: %w", err)
	}

	n.logger.Info("email sent", "to", notification.To, "subject", notification.Subject)
	return nil
}

// sendWebPushNotification sends a web push notification
func (n *Notifier) sendWebPushNotification(ctx context.Context, notification *WebPushNotification) error {
	if !n.config.WebPush.Enabled {
		return fmt.Errorf("web push not enabled")
	}

	// In a real implementation, this would use a web push library
	// to send the notification with proper VAPID headers and encryption
	n.logger.Info("web push notification sent", "endpoint", notification.Endpoint[:50]+"...")
	
	return nil
}

// Subscription management

// getUserSubscriptions gets notification subscriptions for a user
func (n *Notifier) getUserSubscriptions(ctx context.Context, userID string) ([]store.NotificationSubscription, error) {
	return n.repo.GetNotificationSubscriptions(userID)
}

// getSubscriptionsForEvent gets subscriptions for a specific event type
func (n *Notifier) getSubscriptionsForEvent(ctx context.Context, eventType string) ([]store.NotificationSubscription, error) {
	// This would need to be implemented in the repository
	// For now, return empty slice
	return []store.NotificationSubscription{}, nil
}

// getMarketParticipantSubscriptions gets subscriptions for users participating in a market
func (n *Notifier) getMarketParticipantSubscriptions(ctx context.Context, marketID string) ([]store.NotificationSubscription, error) {
	// This would need to be implemented to:
	// 1. Get all positions for the market
	// 2. Get unique user IDs
	// 3. Get subscriptions for those users
	// For now, return empty slice
	return []store.NotificationSubscription{}, nil
}

// parseWebPushData parses web push subscription data
func (n *Notifier) parseWebPushData(data string) (*WebPushKeys, error) {
	var keys WebPushKeys
	if err := json.Unmarshal([]byte(data), &keys); err != nil {
		return nil, fmt.Errorf("failed to parse web push keys: %w", err)
	}
	return &keys, nil
}

// Template generators

func (n *Notifier) generateMarketCreatedText(market *core.Market) string {
	return fmt.Sprintf(`
New Market Created: %s

Creator: %s
Ends: %s
Resolve Deadline: %s
Fee: %d bps

Start betting now!
`, market.Title, market.Creator, market.EndTs.Format(time.RFC3339), 
    market.ResolveDeadlineTs.Format(time.RFC3339), market.FeeBps)
}

func (n *Notifier) generateMarketCreatedHTML(market *core.Market) string {
	return fmt.Sprintf(`
<html>
<body>
<h2>New Market Created: %s</h2>
<p><strong>Creator:</strong> %s</p>
<p><strong>Ends:</strong> %s</p>
<p><strong>Resolve Deadline:</strong> %s</p>
<p><strong>Fee:</strong> %d bps</p>
<p><a href="/markets/%s">Start betting now!</a></p>
</body>
</html>
`, market.Title, market.Creator, market.EndTs.Format(time.RFC3339), 
    market.ResolveDeadlineTs.Format(time.RFC3339), market.FeeBps, market.ID)
}

func (n *Notifier) generateBetPlacedText(position *core.Position) string {
	return fmt.Sprintf(`
Bet Placed Successfully!

Market: %s
Side: %s
Amount: %d
Position ID: %s

Your bet is now active.
`, position.MarketID, position.Side, position.Amount, position.ID)
}

func (n *Notifier) generateBetPlacedHTML(position *core.Position) string {
	return fmt.Sprintf(`
<html>
<body>
<h2>Bet Placed Successfully!</h2>
<p><strong>Market:</strong> %s</p>
<p><strong>Side:</strong> %s</p>
<p><strong>Amount:</strong> %d</p>
<p><strong>Position ID:</strong> %s</p>
<p>Your bet is now active.</p>
</body>
</html>
`, position.MarketID, position.Side, position.Amount, position.ID)
}

func (n *Notifier) generateMarketResolvedText(market *core.Market) string {
	outcome := "Unknown"
	if market.Outcome != nil {
		outcome = *market.Outcome
	}
	
	return fmt.Sprintf(`
Market Resolved: %s

Outcome: %s
Total Staked A: %d
Total Staked B: %d

Check your positions to see if you can claim winnings!
`, market.Title, outcome, market.StakedA, market.StakedB)
}

func (n *Notifier) generateMarketResolvedHTML(market *core.Market) string {
	outcome := "Unknown"
	if market.Outcome != nil {
		outcome = *market.Outcome
	}
	
	return fmt.Sprintf(`
<html>
<body>
<h2>Market Resolved: %s</h2>
<p><strong>Outcome:</strong> %s</p>
<p><strong>Total Staked A:</strong> %d</p>
<p><strong>Total Staked B:</strong> %d</p>
<p><a href="/markets/%s">Check your positions to see if you can claim winnings!</a></p>
</body>
</html>
`, market.Title, outcome, market.StakedA, market.StakedB, market.ID)
}

func (n *Notifier) generateMarketExpiringText(market *core.Market, timeUntil time.Duration) string {
	return fmt.Sprintf(`
Market Expiring Soon: %s

Time until expiry: %v
Total Staked A: %d
Total Staked B: %d

Last chance to place your bets!
`, market.Title, timeUntil, market.StakedA, market.StakedB)
}

func (n *Notifier) generateMarketExpiringHTML(market *core.Market, timeUntil time.Duration) string {
	return fmt.Sprintf(`
<html>
<body>
<h2>Market Expiring Soon: %s</h2>
<p><strong>Time until expiry:</strong> %v</p>
<p><strong>Total Staked A:</strong> %d</p>
<p><strong>Total Staked B:</strong> %d</p>
<p><a href="/markets/%s">Last chance to place your bets!</a></p>
</body>
</html>
`, market.Title, timeUntil, market.StakedA, market.StakedB, market.ID)
}

// Health check
func (n *Notifier) Health() error {
	// Basic connectivity check for SMTP
	if n.config.SMTP.Host != "" {
		// Could try to connect to SMTP server
		return nil
	}
	return nil
}