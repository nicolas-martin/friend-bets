import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { WalletContextState } from '@solana/wallet-adapter-react';

import { FRIENDS_BETS_IDL } from '../idl/friends_bets';
import { PROGRAM_ID } from './chains/solana';

export interface FriendsBetsProgram {
  initializeMarket: any;
  placeBet: any;
  closeBetting: any;
  resolve: any;
  cancelExpired: any;
  claim: any;
  withdrawCreatorFee: any;
  account: {
    market: any;
    position: any;
  };
  methods: any;
}

/**
 * Creates an Anchor program instance with wallet adapter integration
 */
export function createAnchorProgram(
  connection: Connection,
  wallet: WalletContextState,
  programId: PublicKey = PROGRAM_ID
): Program<FriendsBetsProgram> | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null;
  }

  // Create a wallet adapter for Anchor
  const anchorWallet = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions || (async (txs) => {
      if (wallet.signTransaction) {
        return Promise.all(txs.map(tx => wallet.signTransaction!(tx)));
      }
      throw new Error('Wallet does not support signing multiple transactions');
    }),
  };

  const provider = new AnchorProvider(
    connection,
    anchorWallet,
    { commitment: 'confirmed', preflightCommitment: 'confirmed' }
  );

  return new Program(FRIENDS_BETS_IDL as Idl, programId, provider) as Program<FriendsBetsProgram>;
}

/**
 * Fetch market data using Anchor
 */
export async function fetchMarketData(
  program: Program<FriendsBetsProgram>,
  marketAddress: PublicKey
) {
  try {
    const marketData = await program.account.market.fetch(marketAddress);
    return marketData;
  } catch (error) {
    console.error('Failed to fetch market data:', error);
    return null;
  }
}

/**
 * Fetch position data using Anchor
 */
export async function fetchPositionData(
  program: Program<FriendsBetsProgram>,
  positionAddress: PublicKey
) {
  try {
    const positionData = await program.account.position.fetch(positionAddress);
    return positionData;
  } catch (error) {
    console.error('Failed to fetch position data:', error);
    return null;
  }
}

/**
 * Fetch all markets created by a specific creator
 */
export async function fetchMarketsByCreator(
  program: Program<FriendsBetsProgram>,
  creator: PublicKey
) {
  try {
    const markets = await program.account.market.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: creator.toBase58(),
        },
      },
    ]);
    return markets;
  } catch (error) {
    console.error('Failed to fetch markets by creator:', error);
    return [];
  }
}

/**
 * Fetch all positions for a specific owner
 */
export async function fetchPositionsByOwner(
  program: Program<FriendsBetsProgram>,
  owner: PublicKey
) {
  try {
    const positions = await program.account.position.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator  
          bytes: owner.toBase58(),
        },
      },
    ]);
    return positions;
  } catch (error) {
    console.error('Failed to fetch positions by owner:', error);
    return [];
  }
}

/**
 * Subscribe to account changes
 */
export function subscribeToMarket(
  connection: Connection,
  marketAddress: PublicKey,
  callback: (data: any) => void
) {
  return connection.onAccountChange(
    marketAddress,
    (accountInfo) => {
      // Decode the account data here if needed
      callback(accountInfo);
    },
    'confirmed'
  );
}

/**
 * Get transaction signature for confirmation
 */
export async function sendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,
  wallet: WalletContextState,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<string> {
  if (!wallet.signTransaction || !wallet.publicKey) {
    throw new Error('Wallet not connected');
  }

  // Sign the transaction
  const signedTx = await wallet.signTransaction(transaction);
  
  // Send the transaction
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: commitment,
  });

  // Confirm the transaction
  await connection.confirmTransaction(signature, commitment);
  
  return signature;
}