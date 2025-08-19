import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FriendsBets } from "../target/types/friends_bets";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert, expect } from "chai";

describe("friends-bets", () => {
	const provider = anchor.AnchorProvider.env();
	anchor.setProvider(provider);

	const program = anchor.workspace.FriendsBets as Program<FriendsBets>;
	const payer = provider.wallet as anchor.Wallet;

	let mint: anchor.web3.PublicKey;
	let creatorTokenAccount: anchor.web3.PublicKey;
	let userTokenAccount: anchor.web3.PublicKey;
	let market: anchor.web3.PublicKey;
	let vault: anchor.web3.PublicKey;

	const creator = anchor.web3.Keypair.generate();
	const user = anchor.web3.Keypair.generate();

	before(async () => {
		// Airdrop SOL to test accounts
		await provider.connection.requestAirdrop(creator.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
		await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);

		// Create mint
		mint = await createMint(
			provider.connection,
			payer.payer,
			payer.publicKey,
			null,
			6 // 6 decimals
		);

		// Create token accounts
		creatorTokenAccount = await createAccount(
			provider.connection,
			payer.payer,
			mint,
			creator.publicKey
		);

		userTokenAccount = await createAccount(
			provider.connection,
			payer.payer,
			mint,
			user.publicKey
		);

		// Mint tokens to accounts
		await mintTo(
			provider.connection,
			payer.payer,
			mint,
			creatorTokenAccount,
			payer.publicKey,
			1_000_000 // 1M tokens
		);

		await mintTo(
			provider.connection,
			payer.payer,
			mint,
			userTokenAccount,
			payer.publicKey,
			1_000_000 // 1M tokens
		);

		// Derive PDAs
		[market] = anchor.web3.PublicKey.findProgramAddressSync(
			[Buffer.from("market"), creator.publicKey.toBuffer(), mint.toBuffer()],
			program.programId
		);

		[vault] = anchor.web3.PublicKey.findProgramAddressSync(
			[Buffer.from("vault"), market.toBuffer()],
			program.programId
		);
	});

	describe("Happy path", () => {
		it("initializes a market", async () => {
			const now = Math.floor(Date.now() / 1000);
			const endTs = now + 3600; // 1 hour from now
			const resolveDeadlineTs = endTs + 3600; // 2 hours from now

			await program.methods
				.initializeMarket(500, new anchor.BN(endTs), new anchor.BN(resolveDeadlineTs), "Test Market")
				.accounts({
					creator: creator.publicKey,
					market,
					mint,
					vault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([creator])
				.rpc();

			const marketAccount = await program.account.market.fetch(market);
			assert.equal(marketAccount.creator.toString(), creator.publicKey.toString());
			assert.equal(marketAccount.mint.toString(), mint.toString());
			assert.equal(marketAccount.feeBps, 500);
			assert.equal(marketAccount.title, "Test Market");
			assert.deepEqual(marketAccount.status, { open: {} });
		});

		it("places bets on both sides", async () => {
			const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer()],
				program.programId
			);

			// User bets 1000 tokens on side A
			await program.methods
				.placeBet({ a: {} }, new anchor.BN(1000))
				.accounts({
					user: user.publicKey,
					market,
					position: userPosition,
					userTokenAccount,
					vault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([user])
				.rpc();

			const [creatorPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), market.toBuffer(), creator.publicKey.toBuffer()],
				program.programId
			);

			// Creator bets 2000 tokens on side B
			await program.methods
				.placeBet({ b: {} }, new anchor.BN(2000))
				.accounts({
					user: creator.publicKey,
					market,
					position: creatorPosition,
					userTokenAccount: creatorTokenAccount,
					vault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([creator])
				.rpc();

			const marketAccount = await program.account.market.fetch(market);
			assert.equal(marketAccount.stakedA.toString(), "1000");
			assert.equal(marketAccount.stakedB.toString(), "2000");
		});

		it("closes betting after end time", async () => {
			// Wait for end time (in real test, you'd manipulate clock)
			// For now, we'll skip the time check by calling directly

			await program.methods
				.closeBetting()
				.accounts({
					market,
				})
				.rpc();

			const marketAccount = await program.account.market.fetch(market);
			assert.deepEqual(marketAccount.status, { pendingResolve: {} });
		});

		it("resolves market with outcome", async () => {
			await program.methods
				.resolve({ a: {} }) // Side A wins
				.accounts({
					creator: creator.publicKey,
					market,
				})
				.signers([creator])
				.rpc();

			const marketAccount = await program.account.market.fetch(market);
			assert.deepEqual(marketAccount.status, { resolved: {} });
			assert.deepEqual(marketAccount.outcome, { a: {} });
		});

		it("allows winner to claim payout", async () => {
			const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer()],
				program.programId
			);

			const userTokenBalanceBefore = await provider.connection.getTokenAccountBalance(userTokenAccount);

			await program.methods
				.claim()
				.accounts({
					user: user.publicKey,
					market,
					position: userPosition,
					userTokenAccount,
					vault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([user])
				.rpc();

			const userTokenBalanceAfter = await provider.connection.getTokenAccountBalance(userTokenAccount);
			const positionAccount = await program.account.position.fetch(userPosition);

			assert.isTrue(positionAccount.claimed);
			// User should receive more than they put in (they won)
			assert.isTrue(
				parseInt(userTokenBalanceAfter.value.amount) > parseInt(userTokenBalanceBefore.value.amount)
			);
		});

		it("allows creator to withdraw fee", async () => {
			const creatorTokenBalanceBefore = await provider.connection.getTokenAccountBalance(creatorTokenAccount);

			await program.methods
				.withdrawCreatorFee()
				.accounts({
					creator: creator.publicKey,
					market,
					creatorTokenAccount,
					vault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([creator])
				.rpc();

			const creatorTokenBalanceAfter = await provider.connection.getTokenAccountBalance(creatorTokenAccount);
			const marketAccount = await program.account.market.fetch(market);

			assert.isTrue(marketAccount.creatorFeeWithdrawn);
			// Creator should receive their fee
			assert.isTrue(
				parseInt(creatorTokenBalanceAfter.value.amount) > parseInt(creatorTokenBalanceBefore.value.amount)
			);
		});
	});

	describe("Cancel path", () => {
		let cancelMarket: anchor.web3.PublicKey;
		let cancelVault: anchor.web3.PublicKey;

		it("initializes a market that will be cancelled", async () => {
			const creator2 = anchor.web3.Keypair.generate();
			await provider.connection.requestAirdrop(creator2.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);

			[cancelMarket] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("market"), creator2.publicKey.toBuffer(), mint.toBuffer()],
				program.programId
			);

			[cancelVault] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("vault"), cancelMarket.toBuffer()],
				program.programId
			);

			const now = Math.floor(Date.now() / 1000);
			const endTs = now + 10; // Very short betting period
			const resolveDeadlineTs = endTs + 10; // Very short resolution window

			await program.methods
				.initializeMarket(500, new anchor.BN(endTs), new anchor.BN(resolveDeadlineTs), "Cancel Test")
				.accounts({
					creator: creator2.publicKey,
					market: cancelMarket,
					mint,
					vault: cancelVault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([creator2])
				.rpc();
		});

		it("places a bet on the cancel market", async () => {
			const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), cancelMarket.toBuffer(), user.publicKey.toBuffer()],
				program.programId
			);

			await program.methods
				.placeBet({ a: {} }, new anchor.BN(500))
				.accounts({
					user: user.publicKey,
					market: cancelMarket,
					position: userPosition,
					userTokenAccount,
					vault: cancelVault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([user])
				.rpc();
		});

		it("closes betting and cancels expired market", async () => {
			await program.methods
				.closeBetting()
				.accounts({
					market: cancelMarket,
				})
				.rpc();

			// Cancel the expired market
			await program.methods
				.cancelExpired()
				.accounts({
					market: cancelMarket,
				})
				.rpc();

			const marketAccount = await program.account.market.fetch(cancelMarket);
			assert.deepEqual(marketAccount.status, { cancelled: {} });
		});

		it("allows refund claim from cancelled market", async () => {
			const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), cancelMarket.toBuffer(), user.publicKey.toBuffer()],
				program.programId
			);

			const userTokenBalanceBefore = await provider.connection.getTokenAccountBalance(userTokenAccount);

			await program.methods
				.claim()
				.accounts({
					user: user.publicKey,
					market: cancelMarket,
					position: userPosition,
					userTokenAccount,
					vault: cancelVault,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.signers([user])
				.rpc();

			const userTokenBalanceAfter = await provider.connection.getTokenAccountBalance(userTokenAccount);
			const positionAccount = await program.account.position.fetch(userPosition);

			assert.isTrue(positionAccount.claimed);
			// User should get back exactly what they put in (refund)
			assert.equal(
				parseInt(userTokenBalanceAfter.value.amount) - parseInt(userTokenBalanceBefore.value.amount),
				500
			);
		});
	});

	describe("Error cases", () => {
		it("fails to initialize market with fee too high", async () => {
			const badCreator = anchor.web3.Keypair.generate();
			await provider.connection.requestAirdrop(badCreator.publicKey, anchor.web3.LAMPORTS_PER_SOL);

			const [badMarket] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("market"), badCreator.publicKey.toBuffer(), mint.toBuffer()],
				program.programId
			);

			const [badVault] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("vault"), badMarket.toBuffer()],
				program.programId
			);

			try {
				await program.methods
					.initializeMarket(2001, new anchor.BN(Date.now() + 3600), new anchor.BN(Date.now() + 7200), "Bad Market")
					.accounts({
						creator: badCreator.publicKey,
						market: badMarket,
						mint,
						vault: badVault,
						tokenProgram: TOKEN_PROGRAM_ID,
					})
					.signers([badCreator])
					.rpc();

				assert.fail("Should have failed with fee too high");
			} catch (error) {
				expect(error.message).to.include("Fee too high");
			}
		});

		it("prevents double claiming", async () => {
			const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
				[Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer()],
				program.programId
			);

			try {
				await program.methods
					.claim()
					.accounts({
						user: user.publicKey,
						market,
						position: userPosition,
						userTokenAccount,
						vault,
						tokenProgram: TOKEN_PROGRAM_ID,
					})
					.signers([user])
					.rpc();

				assert.fail("Should have failed with already claimed");
			} catch (error) {
				expect(error.message).to.include("Already claimed");
			}
		});
	});
});
