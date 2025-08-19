  🎯 Betting Platform

  - Create two-sided pari-mutuel markets
  - Configurable creator fees (up to 20%)
  - Time-based betting periods with deadlines
  - Automatic market resolution and cancellation
  - Pro-rata payout distribution

  🔐 Security & Reliability

  - Creator-controlled market resolution
  - Automatic refunds for expired markets
  - Rate limiting and spam protection
  - Comprehensive input validation
  - Error recovery mechanisms

  📱 User Experience

  - Mobile-optimized betting interface
  - Real-time odds calculation and display
  - Wallet integration with multiple providers
  - Live countdown timers and status updates
  - Share market links for viral growth

  🔧 Developer Experience

  - Complete CLI tooling and scripts
  - Type-safe protobuf communication
  - Hot reload development environment
  - Comprehensive testing suite
  - Docker deployment ready

  # Build and deploy contracts
  make solana-testnet
  make build && make deploy && make idl

  # Generate protobuf types
  make proto

  # Start backend
  cd apps/backend
  go run cmd/api/main.go &
  go run cmd/worker/main.go &

  # Start web app
  cd apps/web
  npm start
