import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { keccak_256 } from '@noble/hashes/sha3';

import { grpcClient } from '@/lib/grpc';
import { solanaAdapter } from '@/lib/chains/solana';
import { Side } from '@/lib/grpc';
import { showSuccess, showError } from '@/components/Toast';
import { FRIENDS_BETS_IDL } from '@/idl/friends_bets';
import { PROGRAM_ID } from '@/lib/chains/solana';
import { type FriendsBets } from '@/types/friends_bets';

interface CreateMarketParams {
  title: string;
  feeBps: number;
  endTs: number;
  resolveDeadlineTs: number;
}

interface PlaceBetParams {
  marketId: string;
  side: Side;
  amount: number;
}

interface ResolveMarketParams {
  marketId: string;
  outcome: Side;
}

interface ClaimParams {
  marketId: string;
}

function keccakBuf(str: string): Buffer {
  const hash = keccak_256(str);
  return Buffer.from(hash);
}

// Helper to convert gRPC Side to Anchor BetSide format
function sideToAnchorFormat(side: Side) {
  return side === Side.SIDE_A ? { a: {} } : { b: {} };
}

export function useTx() {
  const { publicKey, signTransaction } = useWallet();
  const queryClient = useQueryClient();

  const createMarketMutation = useMutation({
    mutationFn: async (params: CreateMarketParams): Promise<string> => {
      if (!publicKey || !signTransaction) {
        throw new Error('Wallet not connected');
      }

      // Frontend-only transaction creation
      const connection = solanaAdapter.getConnection();
      const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC mint on devnet
      
      // Create Anchor provider with wallet adapter
      const provider = new anchor.AnchorProvider(
        connection,
        {
          publicKey,
          signTransaction: (tx: Transaction) => signTransaction(tx),
          signAllTransactions: (txs: Transaction[]) => Promise.all(txs.map(tx => signTransaction(tx))),
        } as any,
        { commitment: 'confirmed' }
      );
      
      // Fix the IDL structure for Anchor 0.30.1
      // In Anchor 0.30.x, the programId is part of the IDL, not a separate parameter
      const idlCopy = JSON.parse(JSON.stringify(FRIENDS_BETS_IDL));
      
      // Create an IDL with the address field for Anchor 0.30.x
      const formattedIdl = {
        address: PROGRAM_ID.toBase58(), // REQUIRED in 0.30.x - the program ID must be in the IDL
        version: idlCopy.metadata?.version || '0.1.0', 
        name: idlCopy.metadata?.name || 'friends_bets',
        instructions: idlCopy.instructions,
        accounts: [], // Empty accounts to avoid the size field issue
        types: idlCopy.types,
        events: idlCopy.events || [],
        errors: idlCopy.errors || [],
        metadata: idlCopy.metadata
      };
      
      console.log('Using IDL for Anchor 0.30.x:', {
        address: formattedIdl.address,
        version: formattedIdl.version,
        name: formattedIdl.name,
        hasInstructions: !!formattedIdl.instructions,
        instructionCount: formattedIdl.instructions?.length
      });
      
      let program: Program;
      try {
        // In Anchor 0.30.x, don't pass programId as second parameter - it's in the IDL
        program = new Program(formattedIdl as any, provider);
        console.log('Program created successfully with Anchor 0.30.x');
      } catch (error) {
        console.error('Failed to create program:', error);
        throw error;
      }

      // Derive PDAs exactly like on-chain
      // Contract now uses: seeds = [b"market", creator.key().as_ref(), &market_id.to_le_bytes()]
      const marketId = Math.floor(Date.now() / 1000); // Use timestamp as unique market ID
      const marketSeed = Buffer.from("market");
      const marketIdBytes = Buffer.alloc(8);
      marketIdBytes.writeBigUInt64LE(BigInt(marketId), 0);
      
      const [marketPda] = PublicKey.findProgramAddressSync(
        [marketSeed, publicKey.toBuffer(), marketIdBytes],
        PROGRAM_ID
      );
      
      console.log('PDA Derivation Debug:');
      console.log('- Creator (publicKey):', publicKey.toBase58());
      console.log('- Market ID:', marketId);
      console.log('- Derived Market PDA:', marketPda.toBase58());
      console.log('- Program ID:', PROGRAM_ID.toBase58());

      // Get vault PDA (not ATA) - contract uses: seeds = [b"vault", market.key().as_ref()]
      const vaultSeed = Buffer.from("vault");
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [vaultSeed, marketPda.toBuffer()],
        PROGRAM_ID
      );

      // Build instruction via Anchor
      const ix = await program.methods
        .initializeMarket(
          new anchor.BN(marketId), // market_id parameter
          params.feeBps,
          new anchor.BN(params.endTs),
          new anchor.BN(params.resolveDeadlineTs),
          params.title
        )
        .accountsStrict({
          creator: publicKey,
          mint,
          market: marketPda,
          vault: vaultPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();

      // Add compute budget instructions for better reliability
      const prio = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 });
      const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");

      // Build transaction with wallet as fee payer
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(prio, cu, ix);

      // Sign and send
      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize(), { 
        skipPreflight: false 
      });
      
      // Wait for confirmation
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      
      // Check transaction result
      const txResult = await connection.getTransaction(signature, { 
        maxSupportedTransactionVersion: 0 
      });
      
      console.log("Transaction signature:", signature);
      console.log("meta.err:", txResult?.meta?.err);
      console.log("logs:", txResult?.meta?.logMessages);
      
      if (txResult?.meta?.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(txResult.meta.err)}`);
      }
      
      // Notify backend about the successful market creation
      try {
        await grpcClient.confirmMarket({
          txSignature: signature,
          creator: publicKey.toBase58(),
          mint: mint.toBase58(),
          feeBps: params.feeBps,
          endTs: params.endTs,
          resolveDeadlineTs: params.resolveDeadlineTs,
          title: params.title,
        });
        console.log('Market confirmed with backend');
      } catch (backendError) {
        console.error('Failed to confirm market with backend:', backendError);
        // Don't throw here - the on-chain transaction succeeded
      }
      
      showSuccess('Market Created!', `Your prediction market is now live. View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
      console.log('Market creation transaction:', signature);
      console.log('Market PDA:', marketPda.toBase58());
      console.log('Vault PDA:', vaultPda.toBase58());
      
      return marketPda.toBase58();
    },
    onSuccess: () => {
      // Invalidate markets queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['markets'] });
    },
    onError: (error) => {
      console.error('Create market error:', error);
      showError('Market Creation Failed', error.message);
    },
  });

  const placeBetMutation = useMutation({
    mutationFn: async (params: PlaceBetParams): Promise<void> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      const request = {
        marketId: params.marketId,
        owner: publicKey.toString(),
        side: params.side,
        amount: params.amount,
      };

      const response = await grpcClient.placeBet(request);
      
      if (response.unsignedTxBase64) {
        const transaction = await solanaAdapter.deserializeTransaction(response.unsignedTxBase64);
        
        if (!signTransaction) {
          throw new Error('Wallet does not support transaction signing');
        }

        // Set recent blockhash and fee payer if not already set
        const { blockhash } = await solanaAdapter.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Remove any non-signer keys from signatures array
        // The System Program (11111111111111111111111111111111) should not be a signer
        transaction.signatures = transaction.signatures.filter(sig => 
          sig.publicKey.toString() !== '11111111111111111111111111111111'
        );

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
        // Log transaction details for debugging
        const connection = solanaAdapter.getConnection();
        const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
        console.log("Transaction signature:", signature);
        console.log("meta.err:", tx?.meta?.err);
        console.log("logs:", tx?.meta?.logMessages);
        
        showSuccess('Bet Placed!', `Your bet on Side ${params.side === Side.SIDE_A ? 'A' : 'B'} has been submitted. View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
        console.log('Bet transaction:', signature);
      } else {
        throw new Error('Failed to create bet transaction');
      }
    },
    onSuccess: (_, params) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['market', params.marketId] });
      queryClient.invalidateQueries({ queryKey: ['position', params.marketId] });
      queryClient.invalidateQueries({ queryKey: ['markets'] });
    },
    onError: (error) => {
      console.error('Place bet error:', error);
      showError('Bet Failed', error.message);
    },
  });

  const resolveMarketMutation = useMutation({
    mutationFn: async (params: ResolveMarketParams): Promise<void> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      const request = {
        marketId: params.marketId,
        resolver: publicKey.toString(),
        outcome: params.outcome,
      };

      const response = await grpcClient.resolve(request);
      
      if (response.unsignedTxBase64) {
        const transaction = await solanaAdapter.deserializeTransaction(response.unsignedTxBase64);
        
        if (!signTransaction) {
          throw new Error('Wallet does not support transaction signing');
        }

        // Set recent blockhash and fee payer if not already set
        const { blockhash } = await solanaAdapter.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Remove any non-signer keys from signatures array
        // The System Program (11111111111111111111111111111111) should not be a signer
        transaction.signatures = transaction.signatures.filter(sig => 
          sig.publicKey.toString() !== '11111111111111111111111111111111'
        );

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
        // Log transaction details for debugging
        const connection = solanaAdapter.getConnection();
        const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
        console.log("Transaction signature:", signature);
        console.log("meta.err:", tx?.meta?.err);
        console.log("logs:", tx?.meta?.logMessages);
        
        showSuccess('Market Resolved!', `Side ${params.outcome === Side.SIDE_A ? 'A' : 'B'} has been declared the winner. View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
        console.log('Resolve transaction:', signature);
      } else {
        throw new Error('Failed to create resolve transaction');
      }
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: ['market', params.marketId] });
      queryClient.invalidateQueries({ queryKey: ['markets'] });
    },
    onError: (error) => {
      console.error('Resolve market error:', error);
      showError('Resolution Failed', error.message);
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (params: ClaimParams): Promise<void> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      const request = {
        marketId: params.marketId,
        owner: publicKey.toString(),
      };

      const response = await grpcClient.claim(request);
      
      if (response.unsignedTxBase64) {
        const transaction = await solanaAdapter.deserializeTransaction(response.unsignedTxBase64);
        
        if (!signTransaction) {
          throw new Error('Wallet does not support transaction signing');
        }

        // Set recent blockhash and fee payer if not already set
        const { blockhash } = await solanaAdapter.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Remove any non-signer keys from signatures array
        // The System Program (11111111111111111111111111111111) should not be a signer
        transaction.signatures = transaction.signatures.filter(sig => 
          sig.publicKey.toString() !== '11111111111111111111111111111111'
        );

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
        // Log transaction details for debugging
        const connection = solanaAdapter.getConnection();
        const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
        console.log("Transaction signature:", signature);
        console.log("meta.err:", tx?.meta?.err);
        console.log("logs:", tx?.meta?.logMessages);
        
        const payoutAmount = response.payoutAmount ? 
          (response.payoutAmount / Math.pow(10, 6)).toLocaleString() : '0';
        
        showSuccess('Winnings Claimed!', `You received ${payoutAmount} USDC. View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
        console.log('Claim transaction:', signature);
      } else {
        throw new Error('Failed to create claim transaction');
      }
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: ['position', params.marketId] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
    onError: (error) => {
      console.error('Claim error:', error);
      showError('Claim Failed', error.message);
    },
  });

  const createMarket = useCallback(
    (params: CreateMarketParams) => createMarketMutation.mutateAsync(params),
    [createMarketMutation]
  );

  const placeBet = useCallback(
    (params: PlaceBetParams) => placeBetMutation.mutateAsync(params),
    [placeBetMutation]
  );

  const resolveMarket = useCallback(
    (params: ResolveMarketParams) => resolveMarketMutation.mutateAsync(params),
    [resolveMarketMutation]
  );

  const claim = useCallback(
    (params: ClaimParams) => claimMutation.mutateAsync(params),
    [claimMutation]
  );

  const isAnyLoading = 
    createMarketMutation.isPending ||
    placeBetMutation.isPending ||
    resolveMarketMutation.isPending ||
    claimMutation.isPending;

  return {
    createMarket,
    placeBet,
    resolveMarket,
    claim,
    isLoading: isAnyLoading,
    
    // Individual loading states
    isCreatingMarket: createMarketMutation.isPending,
    isPlacingBet: placeBetMutation.isPending,
    isResolvingMarket: resolveMarketMutation.isPending,
    isClaiming: claimMutation.isPending,
  };
}