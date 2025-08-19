#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createProgram } from '../src/anchor';
import { getMarketAddress, getUserPosition } from '../src/pda';

// Load environment variables
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const MINT = new PublicKey(process.env.MINT || '11111111111111111111111111111111');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || process.env.HOME + '/.config/solana/id.json';

async function claimWinnings() {
	try {
		console.log('💰 Claiming winnings...');

		// Parse command line arguments
		const creatorAddress = process.argv[2];

		if (!creatorAddress) {
			console.error('Usage: tsx claim.ts <creator_address>');
			console.error('Example: tsx claim.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
			process.exit(1);
		}

		const creator = new PublicKey(creatorAddress);

		console.log('Creator:', creator.toString());

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

		// Fetch market and position data
		const marketAccount = await program.account.market.fetch(market);
		const positionAccount = await program.account.position.fetch(position);

		console.log('Market:', market.toString());
		console.log('Position:', position.toString());
		console.log('Market status:', marketAccount.status);
		console.log('Market outcome:', marketAccount.outcome ? ('a' in marketAccount.outcome ? 'A' : 'B') : 'None');

		console.log('User position:', {
			side: 'a' in positionAccount.side ? 'A' : 'B',
			amount: positionAccount.amount.toString(),
			claimed: positionAccount.claimed,
		});

		if (positionAccount.claimed) {
			console.log('⚠️ Position already claimed');
			return;
		}

		// Calculate expected payout
		const totalStaked = marketAccount.stakedA.add(marketAccount.stakedB);
		const feeAmount = totalStaked.mul(marketAccount.feeBps).div(10_000);
		const distributable = totalStaked.sub(feeAmount);

		let expectedPayout = '0';
		if (marketAccount.outcome) {
			const userWon =
				('a' in positionAccount.side && 'a' in marketAccount.outcome) ||
				('b' in positionAccount.side && 'b' in marketAccount.outcome);

			if (userWon) {
				const winningSideTotal = 'a' in marketAccount.outcome ? marketAccount.stakedA : marketAccount.stakedB;
				if (winningSideTotal.gt(0)) {
					const payout = distributable.mul(positionAccount.amount).div(winningSideTotal);
					expectedPayout = payout.toString();
				}
			}
		} else if ('cancelled' in marketAccount.status) {
			// Refund in cancelled markets
			expectedPayout = positionAccount.amount.toString();
		}

		console.log('Expected payout:', expectedPayout);

		// Get balance before claim
		const balanceBefore = await connection.getTokenAccountBalance(userTokenAccount);
		console.log('Token balance before:', balanceBefore.value.amount);

		// Claim winnings
		const tx = await program.methods
			.claim()
			.accounts({
				user: user.publicKey,
				market,
				position,
				userTokenAccount,
				vault: marketAccount.vault,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([user])
			.rpc();

		console.log('✅ Claim successful!');
		console.log('Transaction:', tx);

		// Get balance after claim
		const balanceAfter = await connection.getTokenAccountBalance(userTokenAccount);
		console.log('Token balance after:', balanceAfter.value.amount);

		const actualPayout = parseInt(balanceAfter.value.amount) - parseInt(balanceBefore.value.amount);
		console.log('Actual payout received:', actualPayout.toString());

		// Verify claim status
		const updatedPosition = await program.account.position.fetch(position);
		console.log('Position claimed status:', updatedPosition.claimed);

	} catch (error) {
		console.error('❌ Error claiming winnings:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	claimWinnings();
}
