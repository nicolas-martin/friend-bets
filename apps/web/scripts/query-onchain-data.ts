import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { FRIENDS_BETS_IDL } from '@/idl/friends_bets';
import { PROGRAM_ID } from '@/lib/chains/solana';

const DEVNET_RPC = 'https://api.devnet.solana.com';

// Market data as stored on-chain
interface OnChainMarket {
  marketId: anchor.BN;
  creator: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  feeBps: number;
  endTs: anchor.BN;
  resolveDeadlineTs: anchor.BN;
  stakedA: anchor.BN;
  stakedB: anchor.BN;
  status: any; // MarketStatus enum
  outcome: any; // Optional BetSide
  creatorFeeWithdrawn: boolean;
  bump: number;
  vaultBump: number;
  title: string;
}

// Position data as stored on-chain
interface OnChainPosition {
  owner: PublicKey;
  side: any; // BetSide enum
  amount: anchor.BN;
  claimed: boolean;
  bump: number;
}

class OnChainDataFetcher {
  private connection: Connection;
  private program: Program;

  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
    
    // Create a dummy provider for read-only operations
    const provider = new anchor.AnchorProvider(
      this.connection,
      {} as any, // No wallet needed for reading
      { commitment: 'confirmed' }
    );
    
    this.program = new Program(FRIENDS_BETS_IDL as any, PROGRAM_ID, provider);
  }

  // Fetch market data directly from smart contract
  async getMarket(marketPda: PublicKey): Promise<OnChainMarket | null> {
    try {
      const marketAccount = await this.program.account.market.fetch(marketPda);
      return marketAccount as OnChainMarket;
    } catch (error) {
      console.error('Failed to fetch market from chain:', error);
      return null;
    }
  }

  // Fetch position data directly from smart contract
  async getPosition(marketPda: PublicKey, userPubkey: PublicKey): Promise<OnChainPosition | null> {
    try {
      // Derive position PDA
      const positionSeed = Buffer.from("position");
      const [positionPda] = PublicKey.findProgramAddressSync(
        [positionSeed, marketPda.toBuffer(), userPubkey.toBuffer()],
        PROGRAM_ID
      );

      const positionAccount = await this.program.account.position.fetch(positionPda);
      return positionAccount as OnChainPosition;
    } catch (error) {
      console.error('Failed to fetch position from chain:', error);
      return null;
    }
  }

  // Get all positions for a market by scanning position PDAs
  async getAllPositionsForMarket(marketPda: PublicKey): Promise<Array<{pda: PublicKey, data: OnChainPosition}>> {
    try {
      // This is a simplified approach - in production you'd want to use a more efficient method
      // like indexing events or using getProgramAccounts with filters
      const positions: Array<{pda: PublicKey, data: OnChainPosition}> = [];
      
      // For now, we'll just return empty array since we'd need to know all user addresses
      // In production, you'd either:
      // 1. Index events to track all positions
      // 2. Use getProgramAccounts with memcmp filters
      // 3. Store a list of position PDAs in the market account
      
      return positions;
    } catch (error) {
      console.error('Failed to fetch all positions:', error);
      return [];
    }
  }

  // Convert BN to number for display
  formatMarketData(market: OnChainMarket) {
    return {
      marketId: market.marketId.toString(),
      creator: market.creator.toBase58(),
      mint: market.mint.toBase58(),
      vault: market.vault.toBase58(),
      feeBps: market.feeBps,
      endTs: market.endTs.toNumber(),
      resolveDeadlineTs: market.resolveDeadlineTs.toNumber(),
      stakedA: market.stakedA.toNumber(),
      stakedB: market.stakedB.toNumber(),
      totalStaked: market.stakedA.toNumber() + market.stakedB.toNumber(),
      status: market.status,
      outcome: market.outcome,
      creatorFeeWithdrawn: market.creatorFeeWithdrawn,
      title: market.title,
      // Calculate odds
      oddsA: market.stakedB.toNumber() / (market.stakedA.toNumber() + market.stakedB.toNumber()) || 0.5,
      oddsB: market.stakedA.toNumber() / (market.stakedA.toNumber() + market.stakedB.toNumber()) || 0.5,
    };
  }

  formatPositionData(position: OnChainPosition) {
    return {
      owner: position.owner.toBase58(),
      side: position.side,
      amount: position.amount.toNumber(),
      claimed: position.claimed,
    };
  }
}

// Usage examples
async function main() {
  const fetcher = new OnChainDataFetcher();
  
  // Example: Get market data
  const marketPda = new PublicKey('a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS');
  console.log('Fetching market data from chain...');
  
  const market = await fetcher.getMarket(marketPda);
  if (market) {
    const formatted = fetcher.formatMarketData(market);
    console.log('Market data:', formatted);
    console.log(`Total staked: ${formatted.totalStaked / 1000000} USDC`);
    console.log(`Staked A: ${formatted.stakedA / 1000000} USDC`);
    console.log(`Staked B: ${formatted.stakedB / 1000000} USDC`);
  } else {
    console.log('Market not found');
  }
  
  // Example: Get position data
  const userPubkey = new PublicKey('HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G');
  console.log('\nFetching position data from chain...');
  
  const position = await fetcher.getPosition(marketPda, userPubkey);
  if (position) {
    const formatted = fetcher.formatPositionData(position);
    console.log('Position data:', formatted);
    console.log(`Bet amount: ${formatted.amount / 1000000} USDC on side ${formatted.side}`);
  } else {
    console.log('Position not found');
  }
}

export { OnChainDataFetcher };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}