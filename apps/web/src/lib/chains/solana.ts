import {
	Connection,
	PublicKey,
	Transaction,
	LAMPORTS_PER_SOL,
	clusterApiUrl,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddress,
	getAccount,
	getMint,
	TOKEN_PROGRAM_ID
} from '@solana/spl-token';

import {
	ChainAdapter,
	TransactionError,
	NetworkError,
	InvalidAddressError
} from './adapter';

// Constants
export const PROGRAM_ID = new PublicKey("BtNtmmrm3KHc5EmvednmUv43hxL8P3S2fsfPVpffx1Rt");
export const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // USDC on devnet

// Types from the Anchor program
export type BetSide = { a: {} } | { b: {} };
export const BET_SIDE_A: BetSide = { a: {} };
export const BET_SIDE_B: BetSide = { b: {} };

export function betSideToString(side: BetSide): string {
	return 'a' in side ? 'A' : 'B';
}

export function stringToBetSide(side: string): BetSide {
	return side.toUpperCase() === 'A' ? BET_SIDE_A : BET_SIDE_B;
}

/**
 * Solana chain adapter implementation
 */
export class SolanaAdapter implements ChainAdapter {
	public readonly chainId = 'solana-devnet';
	public readonly chainName = 'Solana Devnet';
	public readonly nativeTokenSymbol = 'SOL';
	public readonly nativeTokenDecimals = 9;

	private connection: Connection;

	constructor(rpcEndpoint?: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed') {
		// Use environment variable for RPC URL if available
		const defaultRpcUrl = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 
			clusterApiUrl(process.env.EXPO_PUBLIC_SOLANA_NETWORK as 'devnet' | 'mainnet-beta' || 'devnet');
			
		this.connection = new Connection(
			rpcEndpoint || defaultRpcUrl,
			commitment
		);
	}

	async deserializeTransaction(base64Tx: string): Promise<Transaction> {
		try {
			const buffer = Buffer.from(base64Tx, 'base64');
			return Transaction.from(buffer);
		} catch (error) {
			throw new TransactionError('Failed to deserialize transaction', undefined, error);
		}
	}

	async sendTransaction(signedTx: Transaction): Promise<string> {
		try {
			const signature = await this.connection.sendRawTransaction(
				signedTx.serialize(),
				{
					skipPreflight: false,
					preflightCommitment: 'confirmed',
				}
			);
			return signature;
		} catch (error) {
			throw new TransactionError('Failed to send transaction', undefined, error);
		}
	}

	async confirmTransaction(signature: string): Promise<void> {
		try {
			const confirmation = await this.connection.confirmTransaction(
				signature,
				'confirmed'
			);

			if (confirmation.value.err) {
				throw new TransactionError(
					`Transaction failed: ${confirmation.value.err}`,
					signature
				);
			}
		} catch (error) {
			if (error instanceof TransactionError) {
				throw error;
			}
			throw new TransactionError('Failed to confirm transaction', signature, error);
		}
	}

	isValidAddress(address: string): boolean {
		try {
			new PublicKey(address);
			return true;
		} catch {
			return false;
		}
	}

	normalizeAddress(address: string): string {
		if (!this.isValidAddress(address)) {
			throw new InvalidAddressError(address);
		}
		return new PublicKey(address).toString();
	}

	async getTokenDecimals(mintAddress: string): Promise<number> {
		try {
			const mint = new PublicKey(mintAddress);
			const mintInfo = await getMint(this.connection, mint);
			return mintInfo.decimals;
		} catch (error) {
			throw new NetworkError(`Failed to get token decimals for ${mintAddress}`, error);
		}
	}

	async getTokenBalance(walletAddress: string, mintAddress?: string): Promise<number> {
		try {
			const wallet = new PublicKey(walletAddress);

			if (!mintAddress) {
				// Get SOL balance
				const balance = await this.connection.getBalance(wallet);
				return balance / LAMPORTS_PER_SOL;
			}

			// Get SPL token balance
			const mint = new PublicKey(mintAddress);
			const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
			const accountInfo = await getAccount(this.connection, tokenAccount);

			const decimals = await this.getTokenDecimals(mintAddress);
			return Number(accountInfo.amount) / Math.pow(10, decimals);
		} catch (error) {
			throw new NetworkError(`Failed to get token balance`, error);
		}
	}

	getProgramAddress(): PublicKey {
		return PROGRAM_ID;
	}

	async deriveMarketAddress(creator: string, mint: string): Promise<string> {
		try {
			const creatorKey = new PublicKey(creator);
			const mintKey = new PublicKey(mint);

			const [marketPDA] = PublicKey.findProgramAddressSync(
				[
					Buffer.from("market"),
					creatorKey.toBuffer(),
					mintKey.toBuffer(),
				],
				PROGRAM_ID
			);

			return marketPDA.toString();
		} catch (error) {
			throw new NetworkError('Failed to derive market address', error);
		}
	}

	async derivePositionAddress(market: string, owner: string): Promise<string> {
		try {
			const marketKey = new PublicKey(market);
			const ownerKey = new PublicKey(owner);

			const [positionPDA] = PublicKey.findProgramAddressSync(
				[
					Buffer.from("position"),
					marketKey.toBuffer(),
					ownerKey.toBuffer(),
				],
				PROGRAM_ID
			);

			return positionPDA.toString();
		} catch (error) {
			throw new NetworkError('Failed to derive position address', error);
		}
	}

	async fetchMarketData(marketAddress: string): Promise<any> {
		try {
			// This would use the Anchor program to fetch market data
			// For now, we'll return null as this requires the full Anchor setup
			console.warn('Market data fetching requires Anchor program integration');
			return null;
		} catch (error) {
			throw new NetworkError(`Failed to fetch market data for ${marketAddress}`, error);
		}
	}

	async fetchPositionData(positionAddress: string): Promise<any> {
		try {
			// This would use the Anchor program to fetch position data  
			console.warn('Position data fetching requires Anchor program integration');
			return null;
		} catch (error) {
			throw new NetworkError(`Failed to fetch position data for ${positionAddress}`, error);
		}
	}

	calculateOdds(marketData: any): { sideAOdds: number; sideBOdds: number } {
		if (!marketData) {
			return { sideAOdds: 1, sideBOdds: 1 };
		}

		const stakedA = Number(marketData.stakedA || 0);
		const stakedB = Number(marketData.stakedB || 0);
		const total = stakedA + stakedB;

		if (total === 0) {
			return { sideAOdds: 1, sideBOdds: 1 };
		}

		return {
			sideAOdds: stakedA > 0 ? total / stakedA : Infinity,
			sideBOdds: stakedB > 0 ? total / stakedB : Infinity,
		};
	}

	calculatePayout(marketData: any, side: 'A' | 'B', amount: number): number {
		if (!marketData) return 0;

		const stakedA = Number(marketData.stakedA || 0);
		const stakedB = Number(marketData.stakedB || 0);
		const feeBps = Number(marketData.feeBps || 0);

		// Convert amount to the same units as staked amounts
		const amountLamports = amount * Math.pow(10, 6); // Assuming 6 decimals for USDC

		// Calculate new totals after this bet
		const newStakedA = stakedA + (side === 'A' ? amountLamports : 0);
		const newStakedB = stakedB + (side === 'B' ? amountLamports : 0);
		const newTotal = newStakedA + newStakedB;

		// Calculate fee and distributable amount
		const feeAmount = (newTotal * feeBps) / 10_000;
		const distributable = newTotal - feeAmount;

		// Calculate payout
		const winningSideStake = side === 'A' ? newStakedA : newStakedB;
		const payout = winningSideStake > 0 ? (distributable * amountLamports) / winningSideStake : 0;

		// Convert back to token units
		return payout / Math.pow(10, 6);
	}

	async estimateGasFee(transaction: Transaction): Promise<number> {
		try {
			const { value: feeCalculator } = await this.connection.getLatestBlockhash();

			// Estimate fee based on transaction size and current fee schedule
			// This is a simplified calculation - in practice you'd use getFeeForMessage
			const estimatedFee = 0.000005; // ~5000 lamports typical fee

			return estimatedFee;
		} catch (error) {
			throw new NetworkError('Failed to estimate gas fee', error);
		}
	}

	// Solana-specific helper methods

	async getRecentBlockhash() {
		return await this.connection.getLatestBlockhash();
	}

	async getMinimumBalanceForRentExemption(dataLength: number): Promise<number> {
		return await this.connection.getMinimumBalanceForRentExemption(dataLength);
	}

	getConnection(): Connection {
		return this.connection;
	}
}

// Export a default instance
export const solanaAdapter = new SolanaAdapter();
