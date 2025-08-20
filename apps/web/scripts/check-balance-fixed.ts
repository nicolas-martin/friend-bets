import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

async function checkBalance(): Promise<void> {
  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = new PublicKey('HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G');
    
    // Get associated token account
    const userTokenAccount = getAssociatedTokenAddressSync(
      DEVNET_USDC_MINT,
      wallet,
      false
    );
    
    console.log('Checking balances...');
    console.log('Wallet:', wallet.toBase58());
    console.log('Token account:', userTokenAccount.toBase58());
    console.log('USDC mint:', DEVNET_USDC_MINT.toBase58());
    
    // Check if token account exists
    const accountInfo = await connection.getAccountInfo(userTokenAccount);
    
    if (!accountInfo) {
      console.log('❌ USDC token account does not exist');
      console.log('You have 0 USDC');
      return;
    }
    
    console.log('✅ Token account exists');
    
    // Parse token account data
    try {
      const tokenBalance = await connection.getTokenAccountBalance(userTokenAccount);
      const balance = tokenBalance.value.uiAmount || 0;
      console.log(`💰 USDC Balance: ${balance} USDC`);
      
      if (balance === 0) {
        console.log('\n🚨 You have 0 USDC tokens!');
        console.log('Visit: https://spl-token-faucet.com/?token-name=USDC-Dev');
        console.log('Enter token account:', userTokenAccount.toBase58());
      }
      
    } catch (error) {
      console.log('❌ Error reading token balance:', error);
      
      // Check raw account data
      console.log('Account owner:', accountInfo.owner.toBase58());
      console.log('Account data length:', accountInfo.data.length);
      
      // Expected token account owner
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      if (accountInfo.owner.toBase58() !== TOKEN_PROGRAM_ID) {
        console.log('❌ Account is not owned by Token Program');
        console.log('You have 0 USDC');
      }
    }
    
  } catch (error) {
    console.error('Error checking balance:', error);
  }
}

checkBalance().catch(console.error);