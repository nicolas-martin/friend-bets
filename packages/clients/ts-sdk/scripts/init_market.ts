#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { createProgram } from '../src/anchor';
import { getMarketPDAs } from '../src/pda';

// Load environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const MINT = new PublicKey(process.env.MINT || '11111111111111111111111111111111');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || process.env.HOME + '/.config/solana/id.json';

async function initializeMarket() {
	try {
		console.log('🚀 Initializing market...');

		// Setup connection and wallet
		const connection = new Connection(RPC_URL, 'confirmed');
		const keypairFile = require('fs').readFileSync(KEYPAIR_PATH);
		const creator = Keypair.fromSecretKey(new Uint8Array(JSON.parse(keypairFile.toString())));

		console.log('Creator:', creator.publicKey.toString());
		console.log('Mint:', MINT.toString());

		// Create program instance
		const program = createProgram(connection, {
			publicKey: creator.publicKey,
			signTransaction: async (tx: any) => {
				tx.partialSign(creator);
				return tx;
			},
			signAllTransactions: async (txs: any[]) => {
				txs.forEach(tx => tx.partialSign(creator));
				return txs;
			}
		});

		// Generate market PDAs
		const { market, vault } = getMarketPDAs(creator.publicKey, MINT);

		console.log('Market PDA:', market.toString());
		console.log('Vault PDA:', vault.toString());

		// Market parameters
		const feeBps = 500; // 5%
		const endTs = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now
		const resolveDeadlineTs = new BN(Math.floor(Date.now() / 1000) + 7200); // 2 hours from now
		const title = process.argv[2] || 'Test Market';

		console.log('Fee:', feeBps / 100 + '%');
		console.log('End time:', new Date(endTs.toNumber() * 1000).toISOString());
		console.log('Resolve deadline:', new Date(resolveDeadlineTs.toNumber() * 1000).toISOString());
		console.log('Title:', title);

		// Initialize market
		const tx = await program.methods
			.initializeMarket(feeBps, endTs, resolveDeadlineTs, title)
			.accounts({
				creator: creator.publicKey,
				market,
				mint: MINT,
				vault,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([creator])
			.rpc();

		console.log('✅ Market initialized!');
		console.log('Transaction:', tx);
		console.log('Market address:', market.toString());

		// Verify market was created
		const marketAccount = await program.account.market.fetch(market);
		console.log('Market data:', {
			creator: marketAccount.creator.toString(),
			title: marketAccount.title,
			feeBps: marketAccount.feeBps,
			status: marketAccount.status,
		});

	} catch (error) {
		console.error('❌ Error initializing market:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	initializeMarket();
}
