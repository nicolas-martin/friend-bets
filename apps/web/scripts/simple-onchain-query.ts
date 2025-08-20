import { Connection, PublicKey } from '@solana/web3.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('BtNtmmrm3KHc5EmvednmUv43hxL8P3S2fsfPVpffx1Rt');

// Market status enum values
const MARKET_STATUS = {
  0: 'Unspecified',
  1: 'Open', 
  2: 'Pending Resolve',
  3: 'Resolved',
  4: 'Cancelled'
} as const;

// Bet side enum values  
const BET_SIDE = {
  0: 'A',
  1: 'B'
} as const;

// Raw account data parsing (simplified)
class SimpleOnChainQuery {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
  }

  // Parse market account data (simplified - just extract key fields)
  async getMarketData(marketPda: PublicKey): Promise<any> {
    try {
      const accountInfo = await this.connection.getAccountInfo(marketPda);
      if (!accountInfo) {
        console.log('Market account not found');
        return null;
      }

      const data = accountInfo.data;
      console.log('Raw market data length:', data.length);
      console.log('Raw market data (hex):', data.toString('hex').substring(0, 200) + '...');

      // The market data layout (from the smart contract):
      // - Discriminator: 8 bytes
      // - market_id: 8 bytes (u64)
      // - creator: 32 bytes (pubkey)
      // - mint: 32 bytes (pubkey)
      // - vault: 32 bytes (pubkey)
      // - fee_bps: 2 bytes (u16)
      // - end_ts: 8 bytes (i64)
      // - resolve_deadline_ts: 8 bytes (i64)
      // - staked_a: 8 bytes (u64)
      // - staked_b: 8 bytes (u64)
      // ... and more

      let offset = 8; // Skip discriminator

      // Market ID (u64)
      const marketId = data.readBigUInt64LE(offset);
      offset += 8;

      // Creator (32 bytes)
      const creator = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // Mint (32 bytes)
      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // Vault (32 bytes)
      const vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // Fee BPS (u16)
      const feeBps = data.readUInt16LE(offset);
      offset += 2;

      // End timestamp (i64)
      const endTs = data.readBigInt64LE(offset);
      offset += 8;

      // Resolve deadline timestamp (i64)
      const resolveDeadlineTs = data.readBigInt64LE(offset);
      offset += 8;

      // STAKED A (u64) - This is what we want!
      const stakedA = data.readBigUInt64LE(offset);
      offset += 8;

      // STAKED B (u64) - This is what we want!
      const stakedB = data.readBigUInt64LE(offset);
      offset += 8;

      // Parse status and outcome
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
        status,
        statusText: MARKET_STATUS[status as keyof typeof MARKET_STATUS] || 'Unknown',
        outcome,
        outcomeText: outcome !== null ? BET_SIDE[outcome as keyof typeof BET_SIDE] : null,
        creatorFeeWithdrawn,
        title,
        // Calculate odds (probability of each side winning)
        oddsA: totalStaked > 0 ? stakedBNum / totalStaked : 0.5,
        oddsB: totalStaked > 0 ? stakedANum / totalStaked : 0.5,
        // Calculate multipliers (payout ratio)
        multiplierA: stakedANum > 0 ? totalStaked / stakedANum : 1,
        multiplierB: stakedBNum > 0 ? totalStaked / stakedBNum : 1,
      };

    } catch (error) {
      console.error('Failed to parse market data:', error);
      return null;
    }
  }

  // Parse position account data
  async getPositionData(marketPda: PublicKey, userPubkey: PublicKey): Promise<any> {
    try {
      // Derive position PDA
      const positionSeed = Buffer.from("position");
      const [positionPda] = PublicKey.findProgramAddressSync(
        [positionSeed, marketPda.toBuffer(), userPubkey.toBuffer()],
        PROGRAM_ID
      );

      console.log('Position PDA:', positionPda.toBase58());

      const accountInfo = await this.connection.getAccountInfo(positionPda);
      if (!accountInfo) {
        console.log('Position account not found');
        return null;
      }

      const data = accountInfo.data;
      console.log('Raw position data length:', data.length);
      console.log('Raw position data (hex):', data.toString('hex'));

      // Position data layout:
      // - Discriminator: 8 bytes
      // - owner: 32 bytes (pubkey)
      // - side: 1 byte (enum)
      // - amount: 8 bytes (u64)
      // - claimed: 1 byte (bool)
      // - bump: 1 byte (u8)

      let offset = 8; // Skip discriminator

      // Owner (32 bytes)
      const owner = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // Side (1 byte enum: 0 = A, 1 = B)
      const side = data.readUInt8(offset);
      offset += 1;

      // Amount (u64)
      const amount = data.readBigUInt64LE(offset);
      offset += 8;

      // Claimed (bool)
      const claimed = data.readUInt8(offset) === 1;
      offset += 1;

      const bump = data.readUInt8(offset);

      return {
        owner: owner.toBase58(),
        side: side === 0 ? 'A' : 'B',
        sideText: BET_SIDE[side as keyof typeof BET_SIDE] || 'Unknown',
        amount: Number(amount),
        amountUsdc: Number(amount) / 1000000, // Convert to USDC (6 decimals)
        claimed,
        bump,
        positionPda: positionPda.toBase58(),
      };

    } catch (error) {
      console.error('Failed to parse position data:', error);
      return null;
    }
  }

  // Get all positions for a market by scanning known user addresses
  async getMarketPositions(marketPda: PublicKey, userAddresses: string[]): Promise<any[]> {
    const positions = [];
    
    for (const userAddress of userAddresses) {
      try {
        const userPubkey = new PublicKey(userAddress);
        const position = await this.getPositionData(marketPda, userPubkey);
        if (position) {
          positions.push(position);
        }
      } catch (error) {
        console.error(`Failed to get position for user ${userAddress}:`, error);
      }
    }
    
    return positions;
  }

  // Calculate potential winnings for a position
  calculateWinnings(position: any, market: any): number {
    if (position.claimed) return 0;
    
    // If market is not resolved, can't calculate winnings
    if (market.outcome === null) return 0;
    
    // Check if this position is on the winning side
    const winningSide = BET_SIDE[market.outcome as keyof typeof BET_SIDE];
    if (position.sideText !== winningSide) return 0;
    
    // Calculate winnings based on odds
    const multiplier = position.sideText === 'A' ? market.multiplierA : market.multiplierB;
    return position.amount * multiplier;
  }

  // Format market data for display
  formatMarketSummary(market: any): string {
    const endDate = new Date(market.endTs * 1000);
    const resolveDate = new Date(market.resolveDeadlineTs * 1000);
    
    return `
📊 MARKET SUMMARY
Title: ${market.title}
Status: ${market.statusText}
Creator: ${market.creator.slice(0, 8)}...
${market.outcome !== null ? `Outcome: Side ${market.outcomeText}` : ''}

💰 STAKING
Total: ${(market.totalStaked / 1000000).toFixed(2)} USDC
Side A: ${(market.stakedA / 1000000).toFixed(2)} USDC (${(market.oddsB * 100).toFixed(1)}% odds, ${market.multiplierA.toFixed(2)}x)
Side B: ${(market.stakedB / 1000000).toFixed(2)} USDC (${(market.oddsA * 100).toFixed(1)}% odds, ${market.multiplierB.toFixed(2)}x)

⏰ TIMING
End: ${endDate.toLocaleString()}
Resolve Deadline: ${resolveDate.toLocaleString()}
Fee: ${market.feeBps / 100}%
Creator Fee Withdrawn: ${market.creatorFeeWithdrawn ? 'Yes' : 'No'}
    `.trim();
  }
}

// Test the functionality
async function main() {
  const args = process.argv.slice(2);
  const query = new SimpleOnChainQuery();
  
  // Get market ID from command line or use default
  const marketId = args[0] || 'a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS';
  const userAddress = args[1] || 'HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G';
  
  try {
    const marketPda = new PublicKey(marketId);
    
    console.log('🔍 FETCHING ON-CHAIN DATA...\n');
    console.log(`Market: ${marketId}`);
    console.log(`User: ${userAddress}\n`);
    
    // Get market data
    const market = await query.getMarketData(marketPda);
    if (!market) {
      console.log('❌ Market not found');
      return;
    }
    
    // Display formatted market summary
    console.log(query.formatMarketSummary(market));
    
    // Get position data
    console.log('\n👤 USER POSITION');
    const userPubkey = new PublicKey(userAddress);
    const position = await query.getPositionData(marketPda, userPubkey);
    
    if (position) {
      console.log(`✅ Position found!`);
      console.log(`Side: ${position.sideText}`);
      console.log(`Amount: ${position.amountUsdc.toFixed(2)} USDC`);
      console.log(`Claimed: ${position.claimed ? 'Yes' : 'No'}`);
      console.log(`PDA: ${position.positionPda}`);
      
      // Calculate potential winnings
      const winnings = query.calculateWinnings(position, market);
      if (winnings > 0) {
        console.log(`💰 Potential winnings: ${(winnings / 1000000).toFixed(2)} USDC`);
      } else if (market.outcome !== null) {
        console.log(`❌ This position did not win`);
      } else {
        console.log(`⏳ Market not resolved yet`);
      }
    } else {
      console.log('❌ No position found for this user');
    }
    
    // Show multiple positions if requested
    if (args.includes('--all-positions')) {
      console.log('\n👥 ALL POSITIONS');
      // You can add known user addresses here
      const knownUsers = [
        'HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G',
        '6hbS1d1JRRta3GtJC7XNo16gg3PTb41QJVzy6kWsZnav',
        // Add more user addresses as needed
      ];
      
      const positions = await query.getMarketPositions(marketPda, knownUsers);
      if (positions.length > 0) {
        positions.forEach((pos, i) => {
          console.log(`${i + 1}. ${pos.owner.slice(0, 8)}... - Side ${pos.sideText} - ${pos.amountUsdc.toFixed(2)} USDC`);
        });
      } else {
        console.log('No positions found');
      }
    }
    
    // Show raw data if requested
    if (args.includes('--raw')) {
      console.log('\n🔧 RAW DATA');
      console.log('Market:', JSON.stringify(market, null, 2));
      if (position) {
        console.log('Position:', JSON.stringify(position, null, 2));
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.log('\nUsage: npx tsx scripts/simple-onchain-query.ts [MARKET_ID] [USER_ADDRESS] [--all-positions] [--raw]');
    console.log('Example: npx tsx scripts/simple-onchain-query.ts a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS');
  }
}

export { SimpleOnChainQuery };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}