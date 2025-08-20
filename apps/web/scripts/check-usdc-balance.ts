import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

async function checkUSDCBalance(walletAddress: string): Promise<void> {
  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = new PublicKey(walletAddress);
    
    // Get associated token account
    const userTokenAccount = getAssociatedTokenAddressSync(
      DEVNET_USDC_MINT,
      wallet,
      false
    );
    
    console.log('Wallet:', walletAddress);
    console.log('Token account:', userTokenAccount.toBase58());
    
    // Check token account balance
    const tokenBalance = await connection.getTokenAccountBalance(userTokenAccount);
    
    if (tokenBalance.value) {
      const balance = tokenBalance.value.uiAmount || 0;
      console.log(`USDC Balance: ${balance} USDC`);
    } else {
      console.log('No USDC balance found or token account does not exist');
    }
    
  } catch (error) {
    console.error('Error checking balance:', error);
  }
}

// Run with your wallet address
checkUSDCBalance('HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G').catch(console.error);