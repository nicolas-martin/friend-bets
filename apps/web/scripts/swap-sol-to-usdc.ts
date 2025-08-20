import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
const bs58 = require('bs58').default;

// Configuration
const DEVNET_RPC = 'https://api.devnet.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC (checking if mainnet mint works on devnet)
const SLIPPAGE_BPS = 50; // 0.5%

interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

interface SwapResponse {
  swapTransaction: string;
}

async function getQuote(inputAmount: string): Promise<QuoteResponse> {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${inputAmount}&slippageBps=${SLIPPAGE_BPS}`;
  
  console.log('Getting quote from Jupiter...');
  console.log('URL:', url);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Quote API error: ${response.status} ${response.statusText}`);
  }
  
  const quote = await response.json();
  console.log('Quote received:', JSON.stringify(quote, null, 2));
  
  return quote;
}

async function getSwapTransaction(quote: QuoteResponse, userPublicKey: string): Promise<SwapResponse> {
  const url = 'https://quote-api.jup.ag/v6/swap';
  
  const requestBody = {
    quoteResponse: quote,
    userPublicKey: userPublicKey,
    wrapAndUnwrapSol: true
  };
  
  console.log('Getting swap transaction from Jupiter...');
  console.log('Request body:', JSON.stringify(requestBody, null, 2));
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Swap API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const swapResponse = await response.json();
  console.log('Swap transaction received');
  
  return swapResponse;
}

async function sendTransaction(signedTransaction: string): Promise<string> {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: [signedTransaction, { encoding: 'base64' }]
  };
  
  console.log('Sending transaction to Solana...');
  
  const response = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    throw new Error(`RPC error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`Transaction error: ${result.error.message}`);
  }
  
  console.log('Transaction sent! Signature:', result.result);
  return result.result;
}

export async function swapSolToUsdc(
  privateKeyBase58: string,
  solAmount: number // Amount in SOL (e.g., 0.1 for 0.1 SOL)
): Promise<string> {
  try {
    // Convert SOL to lamports
    const lamports = Math.floor(solAmount * 1e9);
    console.log(`Swapping ${solAmount} SOL (${lamports} lamports) to USDC`);
    
    // Load wallet
    const wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    console.log('Wallet public key:', wallet.publicKey.toBase58());
    
    // Get quote
    const quote = await getQuote(lamports.toString());
    
    // Calculate expected USDC output (assuming 6 decimals)
    const expectedUsdc = parseInt(quote.outAmount) / 1e6;
    console.log(`Expected USDC output: ${expectedUsdc} USDC`);
    console.log(`Price impact: ${quote.priceImpactPct}%`);
    
    // Get swap transaction
    const swapResponse = await getSwapTransaction(quote, wallet.publicKey.toBase58());
    
    // Deserialize and sign transaction
    const transactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    
    console.log('Signing transaction...');
    transaction.sign([wallet]);
    
    // Serialize signed transaction
    const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');
    
    // Send transaction
    const signature = await sendTransaction(signedTransaction);
    
    console.log(`✅ Swap completed! Transaction signature: ${signature}`);
    console.log(`🔗 View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    
    return signature;
    
  } catch (error) {
    console.error('❌ Swap failed:', error);
    throw error;
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.log('Usage: npx tsx scripts/swap-sol-to-usdc.ts <PRIVATE_KEY_BASE58> <SOL_AMOUNT>');
    console.log('Example: npx tsx scripts/swap-sol-to-usdc.ts "your_private_key_here" 0.1');
    process.exit(1);
  }
  
  const [privateKey, solAmountStr] = args;
  const solAmount = parseFloat(solAmountStr);
  
  if (isNaN(solAmount) || solAmount <= 0) {
    console.error('❌ Invalid SOL amount');
    process.exit(1);
  }
  
  try {
    await swapSolToUsdc(privateKey, solAmount);
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}