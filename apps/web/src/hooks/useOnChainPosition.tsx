import { useQuery } from '@tanstack/react-query';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from '@/lib/chains/solana';

const DEVNET_RPC = 'https://api.devnet.solana.com';

interface OnChainPositionData {
  owner: string;
  side: 'A' | 'B';
  amount: number;
  claimed: boolean;
  positionPda: string;
}

class OnChainPositionFetcher {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
  }

  async getPositionData(marketPda: PublicKey, userPubkey: PublicKey): Promise<OnChainPositionData | null> {
    try {
      // Derive position PDA
      const positionSeed = Buffer.from("position");
      const [positionPda] = PublicKey.findProgramAddressSync(
        [positionSeed, marketPda.toBuffer(), userPubkey.toBuffer()],
        PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(positionPda);
      if (!accountInfo) {
        return null; // Position doesn't exist
      }

      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      // Parse position data structure
      const owner = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const side = data.readUInt8(offset);
      offset += 1;

      const amount = data.readBigUInt64LE(offset);
      offset += 8;

      const claimed = data.readUInt8(offset) === 1;

      return {
        owner: owner.toBase58(),
        side: side === 0 ? 'A' : 'B',
        amount: Number(amount),
        claimed,
        positionPda: positionPda.toBase58(),
      };

    } catch (error) {
      console.error('Failed to parse position data:', error);
      return null;
    }
  }
}

const fetcher = new OnChainPositionFetcher();

export function useOnChainPosition(marketId: string, userAddress: string) {
  return useQuery({
    queryKey: ['onchain-position', marketId, userAddress],
    queryFn: async () => {
      if (!marketId || !userAddress) return null;
      
      try {
        const marketPda = new PublicKey(marketId);
        const userPubkey = new PublicKey(userAddress);
        return await fetcher.getPositionData(marketPda, userPubkey);
      } catch (error) {
        console.error('Invalid market ID or user address:', error);
        return null;
      }
    },
    enabled: !!marketId && !!userAddress,
    refetchInterval: 15 * 1000, // Refetch every 15 seconds
    staleTime: 10 * 1000, // Data is fresh for 10 seconds
  });
}

export type { OnChainPositionData };