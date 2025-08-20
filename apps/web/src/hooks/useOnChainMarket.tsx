import { useQuery } from '@tanstack/react-query';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from '@/lib/chains/solana';

const DEVNET_RPC = 'https://api.devnet.solana.com';

interface OnChainMarketData {
  marketId: string;
  creator: string;
  mint: string;
  vault: string;
  feeBps: number;
  endTs: number;
  resolveDeadlineTs: number;
  stakedA: number;
  stakedB: number;
  totalStaked: number;
  oddsA: number;
  oddsB: number;
  status: number;
  outcome: number | null;
  creatorFeeWithdrawn: boolean;
  title: string;
}

class OnChainMarketFetcher {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
  }

  async getMarketData(marketPda: PublicKey): Promise<OnChainMarketData | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(marketPda);
      if (!accountInfo) {
        return null;
      }

      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      // Parse market data structure
      const marketId = data.readBigUInt64LE(offset);
      offset += 8;

      const creator = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const feeBps = data.readUInt16LE(offset);
      offset += 2;

      const endTs = data.readBigInt64LE(offset);
      offset += 8;

      const resolveDeadlineTs = data.readBigInt64LE(offset);
      offset += 8;

      const stakedA = data.readBigUInt64LE(offset);
      offset += 8;

      const stakedB = data.readBigUInt64LE(offset);
      offset += 8;

      // Status (enum as u8)
      const status = data.readUInt8(offset);
      offset += 1;

      // Outcome (Option<BetSide> - 1 byte discriminator + 1 byte value if Some)
      const hasOutcome = data.readUInt8(offset);
      offset += 1;
      const outcome = hasOutcome ? data.readUInt8(offset) : null;
      if (hasOutcome) offset += 1;

      // Creator fee withdrawn (bool)
      const creatorFeeWithdrawn = data.readUInt8(offset) === 1;
      offset += 1;

      // Skip bump and vault_bump
      offset += 2;

      // Title (string) - first 4 bytes are length, then the string data
      const titleLength = data.readUInt32LE(offset);
      offset += 4;
      const titleBytes = data.slice(offset, offset + titleLength);
      const title = titleBytes.toString('utf8');

      const stakedANum = Number(stakedA);
      const stakedBNum = Number(stakedB);
      const totalStaked = stakedANum + stakedBNum;

      return {
        marketId: marketId.toString(),
        creator: creator.toBase58(),
        mint: mint.toBase58(),
        vault: vault.toBase58(),
        feeBps,
        endTs: Number(endTs),
        resolveDeadlineTs: Number(resolveDeadlineTs),
        stakedA: stakedANum,
        stakedB: stakedBNum,
        totalStaked,
        oddsA: totalStaked > 0 ? stakedBNum / totalStaked : 0.5,
        oddsB: totalStaked > 0 ? stakedANum / totalStaked : 0.5,
        status,
        outcome,
        creatorFeeWithdrawn,
        title,
      };

    } catch (error) {
      console.error('Failed to parse market data:', error);
      return null;
    }
  }
}

const fetcher = new OnChainMarketFetcher();

export function useOnChainMarket(marketId: string) {
  return useQuery({
    queryKey: ['onchain-market', marketId],
    queryFn: async () => {
      if (!marketId) return null;
      
      try {
        const marketPda = new PublicKey(marketId);
        return await fetcher.getMarketData(marketPda);
      } catch (error) {
        console.error('Invalid market ID:', error);
        return null;
      }
    },
    enabled: !!marketId,
    refetchInterval: 10 * 1000, // Refetch every 10 seconds for real-time updates
    staleTime: 5 * 1000, // Data is fresh for 5 seconds
  });
}

export type { OnChainMarketData };