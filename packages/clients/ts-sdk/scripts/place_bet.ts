#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { createProgram } from '../src/anchor';
import { getMarketAddress, getUserPosition } from '../src/pda';
import { BET_SIDE_A, BET_SIDE_B, BetSide } from '../src/types';

// Load environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const MINT = new PublicKey(process.env.MINT || '11111111111111111111111111111111');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || process.env.HOME + '/.config/solana/id.json';

async function placeBet() {
	try {
		console.log('🎲 Placing bet...');

		// Parse command line arguments
		const creatorAddress = process.argv[2];
		const sideStr = process.argv[3]?.toUpperCase();
		const amountStr = process.argv[4];

		if (!creatorAddress || !sideStr || !amountStr) {
			console.error('Usage: tsx place_bet.ts <creator_address> <side:A|B> <amount>');
			console.error('Example: tsx place_bet.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM A 1000');
			process.exit(1);
		}

		const creator = new PublicKey(creatorAddress);
		const side: BetSide = sideStr === 'A' ? BET_SIDE_A : BET_SIDE_B;
		const amount = new BN(amountStr);

		console.log('Creator:', creator.toString());
		console.log('Side:', sideStr);
		console.log('Amount:', amount.toString());

		// Setup connection and wallet
		const connection = new Connection(RPC_URL, 'confirmed');
		const keypairFile = require('fs').readFileSync(KEYPAIR_PATH);
		const user = Keypair.fromSecretKey(new Uint8Array(JSON.parse(keypairFile.toString())));

		console.log('User:', user.publicKey.toString());

		// Create program instance
		const program = createProgram(connection, {
			publicKey: user.publicKey,
			signTransaction: async (tx: any) => {
				tx.partialSign(user);
				return tx;
			},
			signAllTransactions: async (txs: any[]) => {
				txs.forEach(tx => tx.partialSign(user));
				return txs;
			}
		});

		// Generate PDAs
		const [market] = getMarketAddress(creator, MINT);
		const { position } = getUserPosition(market, user.publicKey);

		// Get user's token account
		const userTokenAccount = await getAssociatedTokenAddress(MINT, user.publicKey);

		// Fetch market to get vault
		const marketAccount = await program.account.market.fetch(market);
		const vault = marketAccount.vault;

		console.log('Market:', market.toString());
		console.log('Position PDA:', position.toString());
		console.log('User token account:', userTokenAccount.toString());
		console.log('Vault:', vault.toString());

		// Place bet
		const tx = await program.methods
			.placeBet(side, amount)
			.accounts({
				user: user.publicKey,
				market,
				position,
				userTokenAccount,
				vault,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([user])
			.rpc();

		console.log('✅ Bet placed!');
		console.log('Transaction:', tx);

		// Verify bet was placed
		const updatedMarket = await program.account.market.fetch(market);
		const userPosition = await program.account.position.fetch(position);

		console.log('Updated market stakes:', {
			stakedA: updatedMarket.stakedA.toString(),
			stakedB: updatedMarket.stakedB.toString(),
		});

		console.log('User position:', {
			side: 'a' in userPosition.side ? 'A' : 'B',
			amount: userPosition.amount.toString(),
			claimed: userPosition.claimed,
		});

	} catch (error) {
		console.error('❌ Error placing bet:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	placeBet();
}
