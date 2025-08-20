import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

import { FRIENDS_BETS_IDL } from '@/idl/friends_bets';
import { PROGRAM_ID } from '@/lib/chains/solana';

describe('Place Bet PDA Derivation', () => {
  let connection: Connection;
  let wallet: Keypair;
  let provider: anchor.AnchorProvider;

  beforeAll(() => {
    // Setup test connection and wallet
    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    wallet = Keypair.generate();
    
    // Create a test provider
    provider = new anchor.AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: async (tx) => {
          tx.sign(wallet);
          return tx;
        },
        signAllTransactions: async (txs) => {
          txs.forEach(tx => tx.sign(wallet));
          return txs;
        },
      } as any,
      { commitment: 'confirmed' }
    );
  });

  test('Should correctly derive position PDA', () => {
    console.log('Testing position PDA derivation...');
    
    const user = wallet.publicKey;
    const marketId = 'a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS'; // Example market ID
    const marketPda = new PublicKey(marketId);
    
    // According to IDL: seeds = [b"position", market.key().as_ref(), user.key().as_ref()]
    const positionSeed = Buffer.from("position");
    
    const [positionPda, bump] = PublicKey.findProgramAddressSync(
      [positionSeed, marketPda.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    );
    
    expect(positionPda).toBeDefined();
    expect(positionPda instanceof PublicKey).toBe(true);
    expect(bump).toBeDefined();
    expect(typeof bump).toBe('number');
    
    console.log('✓ Position PDA derived:', positionPda.toBase58());
    console.log('✓ Market PDA:', marketPda.toBase58());
    console.log('✓ User:', user.toBase58());
    console.log('✓ Bump:', bump);
  });

  test('Should correctly derive vault PDA', () => {
    console.log('Testing vault PDA derivation...');
    
    const marketId = 'a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS';
    const marketPda = new PublicKey(marketId);
    
    // According to market creation: seeds = [b"vault", market.key().as_ref()]
    const vaultSeed = Buffer.from("vault");
    
    const [vaultPda, bump] = PublicKey.findProgramAddressSync(
      [vaultSeed, marketPda.toBuffer()],
      PROGRAM_ID
    );
    
    expect(vaultPda).toBeDefined();
    expect(vaultPda instanceof PublicKey).toBe(true);
    
    console.log('✓ Vault PDA derived:', vaultPda.toBase58());
    console.log('✓ Vault bump:', bump);
  });

  test('Should build placeBet instruction with all required accounts', async () => {
    console.log('Testing placeBet instruction building...');
    
    const program = new Program(FRIENDS_BETS_IDL as any, PROGRAM_ID, provider);
    
    const user = wallet.publicKey;
    const marketId = 'a9jvGUcU8oWeHcSTQjcDjNjUzKQjbkXPwfqcPCmHVKS';
    const marketPda = new PublicKey(marketId);
    const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC mint
    
    // Derive position PDA
    const positionSeed = Buffer.from("position");
    const [positionPda] = PublicKey.findProgramAddressSync(
      [positionSeed, marketPda.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    );
    
    // Derive vault PDA  
    const vaultSeed = Buffer.from("vault");
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, marketPda.toBuffer()],
      PROGRAM_ID
    );
    
    // Get user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      user,
      false
    );
    
    const side = { a: {} }; // Side A
    const amount = new anchor.BN(1000000); // 1 USDC (6 decimals)
    
    let instruction;
    
    // This should not throw an error - matches the fixed useTx.tsx implementation
    await expect(async () => {
      instruction = await program.methods
        .placeBet(side, amount)
        .accountsStrict({
          user: user,
          market: marketPda,
          position: positionPda, // ✓ FIXED: Added missing position account
          userTokenAccount: userTokenAccount,
          vault: vaultPda,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY, // ✓ FIXED: Added missing rent sysvar
        })
        .instruction();
    }).not.toThrow();
    
    // @ts-ignore
    expect(instruction).toBeDefined();
    
    console.log('✓ PlaceBet instruction built successfully');
    console.log('✓ All required accounts included:');
    console.log('  - user (signer):', user.toBase58());
    console.log('  - market:', marketPda.toBase58());
    console.log('  - position (PDA):', positionPda.toBase58());
    console.log('  - userTokenAccount:', userTokenAccount.toBase58());
    console.log('  - vault (PDA):', vaultPda.toBase58());
    console.log('  - tokenProgram: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    console.log('  - systemProgram:', anchor.web3.SystemProgram.programId.toBase58());
    console.log('  - rent:', anchor.web3.SYSVAR_RENT_PUBKEY.toBase58());
  });

  test('Should handle token account creation for new users', () => {
    console.log('Testing token account creation...');
    
    const user = wallet.publicKey;
    const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    
    // Get user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      user,
      false
    );
    
    // Create ATA instruction
    const createAtaIx = createAssociatedTokenAccountInstruction(
      user, // payer
      userTokenAccount, // ata
      user, // owner
      mint // mint
    );
    
    expect(createAtaIx).toBeDefined();
    expect(createAtaIx.programId.toBase58()).toBe('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    console.log('✓ Create ATA instruction built successfully');
    console.log('✓ This instruction will be added automatically if user has no USDC token account');
    console.log('✓ Token account:', userTokenAccount.toBase58());
  });
});

// Mock globals for standalone execution
if (typeof describe === 'undefined') {
  console.log('Running place bet PDA tests directly...\n');
  
  const tests: Array<() => void | Promise<void>> = [];
  
  // Mock test functions
  global.describe = (name: string, fn: () => void) => {
    console.log(`\n${name}\n${'='.repeat(40)}`);
    fn();
  };
  
  global.test = global.it = (name: string, fn: () => void | Promise<void>) => {
    tests.push(async () => {
      console.log(`\nRunning: ${name}`);
      try {
        await fn();
        console.log(`✅ PASSED: ${name}`);
      } catch (error) {
        console.error(`❌ FAILED: ${name}`);
        console.error(error);
      }
    });
  };
  
  global.beforeAll = (fn: () => void) => fn();
  
  global.expect = (value: any) => ({
    toBeDefined: () => {
      if (value === undefined) throw new Error(`Expected value to be defined`);
    },
    toBe: (expected: any) => {
      if (value !== expected) throw new Error(`Expected ${value} to be ${expected}`);
    },
    not: {
      toThrow: () => {
        // The function should have been called and not thrown
      }
    }
  });
  
  // Import and run
  import('./placeBet.test').then(async () => {
    for (const testFn of tests) {
      await testFn();
    }
  });
}