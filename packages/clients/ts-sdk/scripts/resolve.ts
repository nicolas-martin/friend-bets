#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createProgram } from '../src/anchor';
import { getMarketAddress } from '../src/pda';
import { BET_SIDE_A, BET_SIDE_B, BetSide } from '../src/types';

// Load environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const MINT = new PublicKey(process.env.MINT || '11111111111111111111111111111111');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || process.env.HOME + '/.config/solana/id.json';

async function resolveMarket() {
	try {
		console.log('⚖️ Resolving market...');

		// Parse command line arguments
		const outcomeStr = process.argv[2]?.toUpperCase();

		if (!outcomeStr || !['A', 'B'].includes(outcomeStr)) {
			console.error('Usage: tsx resolve.ts <outcome:A|B>');
			console.error('Example: tsx resolve.ts A');
			process.exit(1);
		}

		const outcome: BetSide = outcomeStr === 'A' ? BET_SIDE_A : BET_SIDE_B;

		console.log('Outcome:', outcomeStr);

		// Setup connection and wallet
		const connection = new Connection(RPC_URL, 'confirmed');
		const keypairFile = require('fs').readFileSync(KEYPAIR_PATH);
		const creator = Keypair.fromSecretKey(new Uint8Array(JSON.parse(keypairFile.toString())));

		console.log('Creator:', creator.publicKey.toString());

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

		// Generate market PDA
		const [market] = getMarketAddress(creator.publicKey, MINT);

		console.log('Market:', market.toString());

		// Check market status before resolving
		const marketAccount = await program.account.market.fetch(market);
		console.log('Current market status:', marketAccount.status);
		console.log('Total staked A:', marketAccount.stakedA.toString());
		console.log('Total staked B:', marketAccount.stakedB.toString());

		// Resolve market
		const tx = await program.methods
			.resolve(outcome)
			.accounts({
				creator: creator.publicKey,
				market,
			})
			.signers([creator])
			.rpc();

		console.log('✅ Market resolved!');
		console.log('Transaction:', tx);
		console.log('Winning side:', outcomeStr);

		// Verify resolution
		const updatedMarket = await program.account.market.fetch(market);
		console.log('Updated market status:', updatedMarket.status);
		console.log('Market outcome:', 'a' in (updatedMarket.outcome || {}) ? 'A' : 'B');

		// Calculate fee info
		const totalStaked = marketAccount.stakedA.add(marketAccount.stakedB);
		const feeAmount = totalStaked.mul(marketAccount.feeBps).div(10_000);

		console.log('Market summary:', {
			totalStaked: totalStaked.toString(),
			feeAmount: feeAmount.toString(),
			winningSide: outcomeStr,
			winningAmount: outcomeStr === 'A' ? marketAccount.stakedA.toString() : marketAccount.stakedB.toString(),
		});

	} catch (error) {
		console.error('❌ Error resolving market:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	resolveMarket();
}
