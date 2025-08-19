import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { FRIENDS_BETS_IDL } from '../../contracts/idl/friends_bets';
import { PROGRAM_ID } from './pda';
import { MarketData, PositionData, MarketInfo, PositionInfo, BetSide, OddsInfo, PayoutInfo } from './types';
import { BN } from '@coral-xyz/anchor';

export interface FriendsBetsProgram {
	initializeMarket: any;
	placeBet: any;
	closeBetting: any;
	resolve: any;
	cancelExpired: any;
	claim: any;
	withdrawCreatorFee: any;
	account: {
		market: any;
		position: any;
	};
}

/**
 * Creates an Anchor program instance
 */
export function createProgram(
	connection: Connection,
	wallet?: any,
	programId: PublicKey = PROGRAM_ID
): Program<FriendsBetsProgram> {
	const provider = new AnchorProvider(
		connection,
		wallet || { publicKey: PublicKey.default, signTransaction: async () => { throw new Error('No wallet'); }, signAllTransactions: async () => { throw new Error('No wallet'); } },
		{ commitment: 'confirmed' }
	);

	return new Program(FRIENDS_BETS_IDL as Idl, programId, provider) as Program<FriendsBetsProgram>;
}

/**
 * Fetches market data
 */
export async function fetchMarket(
	program: Program<FriendsBetsProgram>,
	marketAddress: PublicKey
): Promise<MarketInfo | null> {
	try {
		const data = await program.account.market.fetch(marketAddress);
		return {
			publicKey: marketAddress,
			data: data as MarketData,
		};
	} catch (error) {
		console.warn('Failed to fetch market:', error);
		return null;
	}
}

/**
 * Fetches position data
 */
export async function fetchPosition(
	program: Program<FriendsBetsProgram>,
	positionAddress: PublicKey
): Promise<PositionInfo | null> {
	try {
		const data = await program.account.position.fetch(positionAddress);
		return {
			publicKey: positionAddress,
			data: data as PositionData,
		};
	} catch (error) {
		console.warn('Failed to fetch position:', error);
		return null;
	}
}

/**
 * Fetches all markets created by a specific creator
 */
export async function fetchMarketsByCreator(
	program: Program<FriendsBetsProgram>,
	creator: PublicKey
): Promise<MarketInfo[]> {
	try {
		const markets = await program.account.market.all([
			{
				memcmp: {
					offset: 8, // discriminator
					bytes: creator.toBase58(),
				},
			},
		]);

		return markets.map((market) => ({
			publicKey: market.publicKey,
			data: market.account as MarketData,
		}));
	} catch (error) {
		console.warn('Failed to fetch markets by creator:', error);
		return [];
	}
}

/**
 * Calculates current odds for a market
 */
export function calculateOdds(market: MarketData): OddsInfo {
	const stakedA = market.stakedA.toNumber();
	const stakedB = market.stakedB.toNumber();
	const total = stakedA + stakedB;

	if (total === 0) {
		return {
			sideAOdds: 1.0,
			sideBOdds: 1.0,
			sideARatio: '1:1',
			sideBRatio: '1:1',
		};
	}

	const sideAOdds = total / stakedA;
	const sideBOdds = total / stakedB;

	return {
		sideAOdds: sideAOdds || Infinity,
		sideBOdds: sideBOdds || Infinity,
		sideARatio: `${stakedB}:${stakedA}`,
		sideBRatio: `${stakedA}:${stakedB}`,
	};
}

/**
 * Calculates potential payout for a bet
 */
export function calculatePayout(
	market: MarketData,
	userPosition: PositionData | null,
	additionalAmount?: BN
): PayoutInfo {
	const totalStaked = market.stakedA.add(market.stakedB);
	const feeAmount = totalStaked.mul(new BN(market.feeBps)).div(new BN(10_000));
	const distributable = totalStaked.sub(feeAmount);

	const winningAmount = 'a' in (market.outcome || {}) ? market.stakedA : market.stakedB;
	const losingAmount = 'a' in (market.outcome || {}) ? market.stakedB : market.stakedA;

	let userPayout = new BN(0);

	if (userPosition && market.outcome) {
		const positionSideMatches =
			('a' in userPosition.side && 'a' in market.outcome) ||
			('b' in userPosition.side && 'b' in market.outcome);

		if (positionSideMatches && winningAmount.gt(new BN(0))) {
			const totalUserAmount = additionalAmount
				? userPosition.amount.add(additionalAmount)
				: userPosition.amount;

			userPayout = distributable.mul(totalUserAmount).div(winningAmount);
		}
	}

	return {
		totalStaked,
		feeAmount,
		distributable,
		winningAmount,
		losingAmount,
		userPayout,
	};
}

/**
 * Estimates payout for a potential bet before placing it
 */
export function estimatePayoutForBet(
	market: MarketData,
	side: BetSide,
	amount: BN
): { payout: BN; odds: number } {
	// Simulate the bet by adding the amount to the appropriate side
	const newStakedA = 'a' in side ? market.stakedA.add(amount) : market.stakedA;
	const newStakedB = 'b' in side ? market.stakedB.add(amount) : market.stakedB;

	const newTotal = newStakedA.add(newStakedB);
	const feeAmount = newTotal.mul(new BN(market.feeBps)).div(new BN(10_000));
	const distributable = newTotal.sub(feeAmount);

	const winningSide = 'a' in side ? newStakedA : newStakedB;

	const payout = winningSide.gt(new BN(0))
		? distributable.mul(amount).div(winningSide)
		: new BN(0);

	const odds = payout.toNumber() / amount.toNumber();

	return { payout, odds };
}
