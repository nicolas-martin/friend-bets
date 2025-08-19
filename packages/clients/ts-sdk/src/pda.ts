import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/**
 * Derives the market PDA
 */
export function getMarketAddress(
	creator: PublicKey,
	mint: PublicKey,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from("market"),
			creator.toBuffer(),
			mint.toBuffer(),
		],
		programId
	);
}

/**
 * Derives the vault PDA for a market
 */
export function getVaultAddress(
	market: PublicKey,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from("vault"),
			market.toBuffer(),
		],
		programId
	);
}

/**
 * Derives the position PDA for a user in a market
 */
export function getPositionAddress(
	market: PublicKey,
	owner: PublicKey,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from("position"),
			market.toBuffer(),
			owner.toBuffer(),
		],
		programId
	);
}

/**
 * Get all PDAs for a market
 */
export function getMarketPDAs(creator: PublicKey, mint: PublicKey, programId: PublicKey = PROGRAM_ID) {
	const [market, marketBump] = getMarketAddress(creator, mint, programId);
	const [vault, vaultBump] = getVaultAddress(market, programId);

	return {
		market,
		marketBump,
		vault,
		vaultBump,
	};
}

/**
 * Get position PDA for a specific user and market
 */
export function getUserPosition(market: PublicKey, user: PublicKey, programId: PublicKey = PROGRAM_ID) {
	const [position, positionBump] = getPositionAddress(market, user, programId);

	return {
		position,
		positionBump,
	};
}
