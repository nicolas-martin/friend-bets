#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createProgram } from '../src/anchor';
import { getMarketAddress } from '../src/pda';

// Load environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const MINT = new PublicKey(process.env.MINT || '11111111111111111111111111111111');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || process.env.HOME + '/.config/solana/id.json';

async function closeBetting() {
	try {
		console.log('🔒 Closing betting period...');

		// Parse command line arguments
		const creatorAddress = process.argv[2];

		if (!creatorAddress) {
			console.error('Usage: tsx close_betting.ts <creator_address>');
			console.error('Example: tsx close_betting.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
			process.exit(1);
		}

		const creator = new PublicKey(creatorAddress);

		console.log('Creator:', creator.toString());

		// Setup connection and wallet (can be anyone, not just creator)
		const connection = new Connection(RPC_URL, 'confirmed');
		const keypairFile = require('fs').readFileSync(KEYPAIR_PATH);
		const signer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(keypairFile.toString())));

		console.log('Signer:', signer.publicKey.toString());

		// Create program instance
		const program = createProgram(connection, {
			publicKey: signer.publicKey,
			signTransaction: async (tx: any) => {
				tx.partialSign(signer);
				return tx;
			},
			signAllTransactions: async (txs: any[]) => {
				txs.forEach(tx => tx.partialSign(signer));
				return txs;
			}
		});

		// Generate market PDA
		const [market] = getMarketAddress(creator, MINT);

		console.log('Market:', market.toString());

		// Check market status before closing
		const marketAccount = await program.account.market.fetch(market);
		console.log('Current market status:', marketAccount.status);
		console.log('End timestamp:', new Date(marketAccount.endTs.toNumber() * 1000).toISOString());
		console.log('Current time:', new Date().toISOString());
		console.log('Total staked A:', marketAccount.stakedA.toString());
		console.log('Total staked B:', marketAccount.stakedB.toString());

		// Check if betting period has ended
		const currentTime = Math.floor(Date.now() / 1000);
		if (currentTime < marketAccount.endTs.toNumber()) {
			console.log('⚠️ Betting period has not ended yet');
			console.log('Time remaining:', marketAccount.endTs.toNumber() - currentTime, 'seconds');
			// In a real scenario, you might want to exit here
			// For demo purposes, we'll proceed anyway
		}

		// Close betting
		const tx = await program.methods
			.closeBetting()
			.accounts({
				market,
			})
			.signers([signer])
			.rpc();

		console.log('✅ Betting period closed!');
		console.log('Transaction:', tx);

		// Verify status change
		const updatedMarket = await program.account.market.fetch(market);
		console.log('Updated market status:', updatedMarket.status);
		console.log('Resolve deadline:', new Date(updatedMarket.resolveDeadlineTs.toNumber() * 1000).toISOString());

		const totalStaked = updatedMarket.stakedA.add(updatedMarket.stakedB);
		const feeAmount = totalStaked.mul(updatedMarket.feeBps).div(10_000);

		console.log('Market summary:', {
			title: updatedMarket.title,
			totalStaked: totalStaked.toString(),
			potentialFee: feeAmount.toString(),
			status: 'Ready for resolution by creator',
		});

	} catch (error) {
		console.error('❌ Error closing betting:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	closeBetting();
}
