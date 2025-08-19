# Friend Bets Web App

A React Native Web application for decentralized prediction markets on Solana.

## Features

- **Mobile-First Design**: Optimized for mobile devices with responsive web support
- **Solana Integration**: Connect with popular Solana wallets (Phantom, Solflare, Backpack)
- **Prediction Markets**: Create and participate in peer-to-peer betting markets
- **Real-Time Updates**: Live market data and odds calculations
- **Secure Transactions**: All bets secured by Solana smart contracts

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:8081`

### Build for Production

```bash
npm run build:prod
```

## Architecture

### Tech Stack

- **React Native Web**: Cross-platform UI framework
- **Expo Router**: File-based routing system
- **React Native Paper**: Material Design components
- **Solana Wallet Adapter**: Wallet connection management
- **TanStack Query**: Data fetching and caching
- **Connect-Web**: gRPC client for backend communication
- **Zustand**: State management

### Project Structure

```
src/
├── app/              # Expo Router pages
├── components/       # Reusable UI components
├── hooks/           # Custom React hooks
├── lib/             # Core libraries and adapters
│   └── chains/      # Blockchain adapters
├── styles/          # Theme and styling
└── idl/            # Anchor program IDL
```

### Key Features

#### Wallet Integration
- Supports all major Solana wallets
- Automatic wallet detection
- Secure transaction signing

#### Market Creation
- Custom market titles and parameters
- Flexible fee structures (0-20%)
- Automated deadline enforcement

#### Betting Interface
- Live odds calculation
- Slippage protection
- Real-time payout previews

#### Market Resolution
- Creator-controlled outcomes
- Automatic cancellation for expired markets
- Pro-rata payout distribution

## API Integration

The app integrates with the Friend Bets backend via gRPC:

- **Market Management**: Create, list, and update markets
- **Betting Operations**: Place bets and claim winnings  
- **Real-Time Events**: WebSocket connections for live updates

## Chain Adapter Pattern

The app uses a chain adapter pattern for future multi-chain support:

```typescript
interface ChainAdapter {
  chainId: string;
  sendTransaction(tx: Transaction): Promise<string>;
  // ... other blockchain operations
}
```

Current implementation supports Solana, with easy extensibility for other chains.

## Environment Variables

Create a `.env.local` file:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080
EXPO_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
```

## Development

### Running Tests

```bash
npm run test
```

### Code Quality

```bash
npm run lint
npm run type-check
```

### Building

```bash
# Web build
npm run build

# Production optimized build  
npm run build:prod
```

## Deployment

The app can be deployed to any static hosting service:

1. Build the production bundle
2. Upload the `dist/` folder to your hosting provider
3. Configure your domain and CDN

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License - see LICENSE file for details.