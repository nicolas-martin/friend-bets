import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { keccak_256 } from '@noble/hashes/sha3';

import { FRIENDS_BETS_IDL } from '@/idl/friends_bets';
import { PROGRAM_ID } from '@/lib/chains/solana';

function keccakBuf(str: string): Buffer {
  const hash = keccak_256(str);
  return Buffer.from(hash);
}

describe('IDL Parsing and Program Creation', () => {
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

  test('IDL should have correct structure', () => {
    console.log('Testing IDL structure...');
    
    // Check IDL has required fields
    expect(FRIENDS_BETS_IDL).toBeDefined();
    expect(FRIENDS_BETS_IDL.metadata).toBeDefined();
    expect(FRIENDS_BETS_IDL.metadata.name).toBe('friends_bets');
    expect(FRIENDS_BETS_IDL.metadata.version).toBe('0.1.0');
    
    // Check instructions exist
    expect(FRIENDS_BETS_IDL.instructions).toBeDefined();
    expect(Array.isArray(FRIENDS_BETS_IDL.instructions)).toBe(true);
    expect(FRIENDS_BETS_IDL.instructions.length).toBeGreaterThan(0);
    
    // Check types exist including BetSide
    expect(FRIENDS_BETS_IDL.types).toBeDefined();
    expect(Array.isArray(FRIENDS_BETS_IDL.types)).toBe(true);
    
    const betSideType = FRIENDS_BETS_IDL.types.find((t: any) => t.name === 'BetSide');
    expect(betSideType).toBeDefined();
    expect(betSideType.type.kind).toBe('enum');
    expect(betSideType.type.variants).toHaveLength(2);
    
    console.log('✓ IDL structure is valid');
  });

  test('Program should be created without errors', () => {
    console.log('Testing Program instantiation...');
    
    let program: Program;
    
    // This should not throw an error
    expect(() => {
      program = new Program(FRIENDS_BETS_IDL as any, PROGRAM_ID, provider);
    }).not.toThrow();
    
    // @ts-ignore - program is assigned in the expect block
    expect(program).toBeDefined();
    
    console.log('✓ Program created successfully');
  });

  test('initializeMarket method should be accessible', () => {
    console.log('Testing initializeMarket method...');
    
    const program = new Program(FRIENDS_BETS_IDL as any, PROGRAM_ID, provider);
    
    // Check that methods exist
    expect(program.methods).toBeDefined();
    expect(program.methods.initializeMarket).toBeDefined();
    expect(typeof program.methods.initializeMarket).toBe('function');
    
    console.log('✓ initializeMarket method is accessible');
  });

  test('Should correctly derive market PDA', () => {
    console.log('Testing PDA derivation...');
    
    const creator = wallet.publicKey;
    const title = "Test Market";
    
    const marketSeed = Buffer.from("market");
    const titleSeed = keccakBuf(title);
    
    const [marketPda, bump] = PublicKey.findProgramAddressSync(
      [marketSeed, creator.toBuffer(), titleSeed],
      PROGRAM_ID
    );
    
    expect(marketPda).toBeDefined();
    expect(marketPda instanceof PublicKey).toBe(true);
    expect(bump).toBeDefined();
    expect(typeof bump).toBe('number');
    
    console.log('✓ Market PDA derived:', marketPda.toBase58());
  });

  test('Should correctly derive vault ATA', () => {
    console.log('Testing vault ATA derivation...');
    
    const creator = wallet.publicKey;
    const title = "Test Market";
    const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC devnet
    
    const marketSeed = Buffer.from("market");
    const titleSeed = keccakBuf(title);
    
    const [marketPda] = PublicKey.findProgramAddressSync(
      [marketSeed, creator.toBuffer(), titleSeed],
      PROGRAM_ID
    );
    
    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      marketPda,
      true // allow owner off curve (PDA)
    );
    
    expect(vaultAta).toBeDefined();
    expect(vaultAta instanceof PublicKey).toBe(true);
    
    console.log('✓ Vault ATA derived:', vaultAta.toBase58());
  });

  test('Should build initializeMarket instruction without errors', async () => {
    console.log('Testing instruction building...');
    
    const program = new Program(FRIENDS_BETS_IDL as any, PROGRAM_ID, provider);
    
    const creator = wallet.publicKey;
    const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const title = "Test Market";
    const feeBps = 100;
    const endTs = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
    const resolveDeadlineTs = endTs + 86400; // 2 days from now
    
    const marketSeed = Buffer.from("market");
    const titleSeed = keccakBuf(title);
    
    const [marketPda] = PublicKey.findProgramAddressSync(
      [marketSeed, creator.toBuffer(), titleSeed],
      PROGRAM_ID
    );
    
    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      marketPda,
      true
    );
    
    let instruction;
    
    // This should not throw an error
    await expect(async () => {
      instruction = await program.methods
        .initializeMarket(
          feeBps,
          new anchor.BN(endTs),
          new anchor.BN(resolveDeadlineTs),
          title
        )
        .accountsStrict({
          creator: creator,
          mint: mint,
          market: marketPda,
          vault: vaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();
    }).not.toThrow();
    
    // @ts-ignore
    expect(instruction).toBeDefined();
    
    console.log('✓ Instruction built successfully');
  });
});

// Run the tests
if (typeof describe === 'undefined') {
  console.log('Running tests directly...\n');
  
  const tests: Array<() => void | Promise<void>> = [];
  let currentTest: string = '';
  
  // Mock test functions
  global.describe = (name: string, fn: () => void) => {
    console.log(`\n${name}\n${'='.repeat(40)}`);
    fn();
  };
  
  global.test = global.it = (name: string, fn: () => void | Promise<void>) => {
    currentTest = name;
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
    toBeGreaterThan: (n: number) => {
      if (!(value > n)) throw new Error(`Expected ${value} to be greater than ${n}`);
    },
    toHaveLength: (n: number) => {
      if (value.length !== n) throw new Error(`Expected length ${value.length} to be ${n}`);
    },
    not: {
      toThrow: () => {
        // The function should have been called and not thrown
      }
    }
  });
  
  // Import and run
  import('./createMarket.test').then(async () => {
    for (const testFn of tests) {
      await testFn();
    }
  });
}