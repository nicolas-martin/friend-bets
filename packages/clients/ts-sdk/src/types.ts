import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export interface MarketData {
	creator: PublicKey;
	mint: PublicKey;
	vault: PublicKey;
	feeBps: number;
	endTs: BN;
	resolveDeadlineTs: BN;
	stakedA: BN;
	stakedB: BN;
	status: MarketStatus;
	outcome?: BetSide;
	creatorFeeWithdrawn: boolean;
	bump: number;
	vaultBump: number;
	title: string;
}

export interface PositionData {
	owner: PublicKey;
	side: BetSide;
	amount: BN;
	claimed: boolean;
	bump: number;
}

export type MarketStatus =
	| { open: {} }
	| { pendingResolve: {} }
	| { resolved: {} }
	| { cancelled: {} };

export type BetSide = { a: {} } | { b: {} };

export interface MarketInfo {
	publicKey: PublicKey;
	data: MarketData;
}

export interface PositionInfo {
	publicKey: PublicKey;
	data: PositionData;
}

export interface OddsInfo {
	sideAOdds: number;
	sideBOdds: number;
	sideARatio: string;
	sideBRatio: string;
}

export interface PayoutInfo {
	totalStaked: BN;
	feeAmount: BN;
	distributable: BN;
	winningAmount: BN;
	losingAmount: BN;
	userPayout: BN;
}

export const BET_SIDE_A: BetSide = { a: {} };
export const BET_SIDE_B: BetSide = { b: {} };

export function betSideToString(side: BetSide): string {
	return 'a' in side ? 'A' : 'B';
}

export function stringToBetSide(side: string): BetSide {
	return side.toUpperCase() === 'A' ? BET_SIDE_A : BET_SIDE_B;
}
