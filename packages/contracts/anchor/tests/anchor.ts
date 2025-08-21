import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { FriendsBets } from "../target/types/friends_bets";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("friends-bets", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FriendsBets as Program<FriendsBets>;

  // Keypairs
  const creator = Keypair.generate();
  const bettor = Keypair.generate();

  // Mints
  let usdcMint: PublicKey;

  // Token Accounts
  let bettorUsdcAccount: PublicKey;
  let creatorUsdcAccount: PublicKey;

  before(async () => {
    // Airdrop SOL
    await provider.connection.requestAirdrop(
      creator.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const bettorAirdrop = await provider.connection.requestAirdrop(
      bettor.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(bettorAirdrop);

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      creator, // payer
      creator.publicKey, // mint authority
      creator.publicKey, // freeze authority
      6 // decimals
    );

    // Create bettor's USDC token account
    bettorUsdcAccount = await createAssociatedTokenAccount(
      provider.connection,
      bettor, // payer
      usdcMint, // mint
      bettor.publicKey // owner
    );

    creatorUsdcAccount = await createAssociatedTokenAccount(
      provider.connection,
      creator, // payer
      usdcMint, // mint
      creator.publicKey // owner
    );

    // Mint some USDC to the bettor
    await mintTo(
      provider.connection,
      creator, // payer
      usdcMint, // mint
      bettorUsdcAccount, // destination
      creator.publicKey, // authority
      1000 * 10 ** 6 // 1000 USDC
    );
  });

  it("prevents betting on both sides", async () => {
    const marketId = new BN(1);
    const now = Math.floor(Date.now() / 1000);
    const endTs = new BN(now + 3600);
    const resolveDeadlineTs = new BN(now + 7200);
    const feeBps = 100; // 1%
    const title = "Will it rain tomorrow?";

    const [marketPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        marketId.toBuffer("le", 8),
      ],
      program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId
    );

    // Initialize market
    await program.methods
      .initializeMarket(
        marketId,
        feeBps,
        endTs,
        resolveDeadlineTs,
        title
      )
      .accounts({
        creator: creator.publicKey,
        market: marketPda,
        mint: usdcMint,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        marketPda.toBuffer(),
        bettor.publicKey.toBuffer(),
      ],
      program.programId
    );

    const betAmount = new BN(10 * 10 ** 6); // 10 USDC

    // Place bet on side A (should succeed)
    await program.methods
      .placeBet({ a: {} }, betAmount)
      .accounts({
        user: bettor.publicKey,
        market: marketPda,
        position: positionPda,
        userTokenAccount: bettorUsdcAccount,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bettor])
      .rpc();

    let positionAccount = await program.account.position.fetch(positionPda);
    assert.ok(positionAccount.side.hasOwnProperty("a"));
    assert.equal(positionAccount.amount.toString(), betAmount.toString());

    // Try to place bet on side B (should fail)
    try {
      await program.methods
        .placeBet({ b: {} }, betAmount)
        .accounts({
          user: bettor.publicKey,
          market: marketPda,
          position: positionPda,
          userTokenAccount: bettorUsdcAccount,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([bettor])
        .rpc();
      assert.fail("Betting on the opposing side should have failed");
    } catch (err) {
      assert.include(err.message, "User cannot bet on opposing sides in the same market");
      assert.equal(err.error.errorCode.code, "BetOnBothSidesNotAllowed");
    }

    // Place another bet on side A (should succeed)
    await program.methods
      .placeBet({ a: {} }, betAmount)
      .accounts({
        user: bettor.publicKey,
        market: marketPda,
        position: positionPda,
        userTokenAccount: bettorUsdcAccount,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bettor])
      .rpc();

    positionAccount = await program.account.position.fetch(positionPda);
    assert.ok(positionAccount.side.hasOwnProperty("a"));
    assert.equal(positionAccount.amount.toString(), betAmount.mul(new BN(2)).toString());
  });
});
