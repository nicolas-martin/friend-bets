import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
const bs58 = require('bs58').default;

// Devnet USDC mint (this is the actual devnet USDC)
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const DEVNET_RPC = 'https://api.devnet.solana.com';

async function getDevnetUSDC(privateKeyBase58: string, amount: number = 100): Promise<string> {
  try {
    console.log(`Getting ${amount} USDC from devnet faucet...`);
    
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    
    console.log('Wallet address:', wallet.publicKey.toBase58());
    
    // Get associated token account
    const userTokenAccount = getAssociatedTokenAddressSync(
      DEVNET_USDC_MINT,
      wallet.publicKey,
      false
    );
    
    console.log('Token account:', userTokenAccount.toBase58());
    
    // Check if token account exists
    const accountInfo = await connection.getAccountInfo(userTokenAccount);
    const instructions = [];
    
    if (!accountInfo) {
      console.log('Creating token account...');
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer
        userTokenAccount, // ata
        wallet.publicKey, // owner
        DEVNET_USDC_MINT // mint
      );
      instructions.push(createAtaIx);
    } else {
      console.log('Token account already exists');
    }
    
    // Use devnet USDC faucet API
    console.log('Requesting USDC from devnet faucet...');
    
    // Try using Solana devnet faucet
    const faucetResponse = await fetch('https://api.devnet.solana.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'requestAirdrop',
        params: [userTokenAccount.toBase58(), amount * 1000000] // Convert to microlamports
      })
    });
    
    if (faucetResponse.ok) {
      const result = await faucetResponse.json();
      if (result.result) {
        console.log('✅ USDC airdrop successful!');
        console.log('Transaction signature:', result.result);
        return result.result;
      }
    }
    
    // If airdrop doesn't work, try web-based approach
    console.log('Faucet API failed, trying web interface...');
    console.log('Go to: https://spl-token-faucet.com/?token-name=USDC-Dev');
    console.log('Enter your token account address:', userTokenAccount.toBase58());
    console.log('Or try: https://faucet.quicknode.com/');
    
    return 'manual';
    
  } catch (error) {
    console.error('❌ Failed to get devnet USDC:', error);
    throw error;
  }
}

// Alternative: Create a script to mint devnet USDC if you have mint authority
async function mintDevnetUSDC(privateKeyBase58: string, amount: number = 100): Promise<string> {
  console.log('This requires mint authority for devnet USDC...');
  console.log('Try these alternatives:');
  console.log('1. https://spl-token-faucet.com/?token-name=USDC-Dev');
  console.log('2. https://faucet.quicknode.com/');
  console.log('3. https://faucet.solana.com/');
  
  return 'manual_required';
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: npx tsx scripts/get-devnet-usdc.ts <PRIVATE_KEY_BASE58> [AMOUNT]');
    console.log('Example: npx tsx scripts/get-devnet-usdc.ts "your_private_key_here" 100');
    process.exit(1);
  }
  
  const [privateKey, amountStr] = args;
  const amount = amountStr ? parseFloat(amountStr) : 100;
  
  if (isNaN(amount) || amount <= 0) {
    console.error('❌ Invalid amount');
    process.exit(1);
  }
  
  try {
    const result = await getDevnetUSDC(privateKey, amount);
    if (result === 'manual') {
      console.log('\n📝 Manual steps required:');
      console.log('1. Visit one of the faucet URLs above');
      console.log('2. Enter your token account address');
      console.log('3. Request USDC tokens');
    }
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

// Export for use in other scripts
export { getDevnetUSDC, DEVNET_USDC_MINT };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}