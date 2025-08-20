import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { grpcClient } from '@/lib/grpc';
import { solanaAdapter } from '@/lib/chains/solana';
import { Side } from '@/lib/grpc';
import { showSuccess, showError } from '@/components/Toast';

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

export function useTx() {
  const { publicKey, signTransaction } = useWallet();
  const queryClient = useQueryClient();

  const createMarketMutation = useMutation({
    mutationFn: async (params: CreateMarketParams): Promise<string> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      const request = {
        ...params,
        creator: publicKey.toString(),
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
      };

      const response = await grpcClient.createMarket(request);
      
      if (response.unsignedTxBase64) {
        // Sign and submit the transaction
        const transaction = await solanaAdapter.deserializeTransaction(response.unsignedTxBase64);
        
        if (!signTransaction) {
          throw new Error('Wallet does not support transaction signing');
        }

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        // Wait for confirmation
        await solanaAdapter.confirmTransaction(signature);
        
        showSuccess('Market Created!', `Your prediction market is now live. View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
        console.log('Market creation transaction:', signature);
        return response.marketId;
      }

      throw new Error('Failed to create market transaction');
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

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
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

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
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

        const signedTx = await signTransaction(transaction);
        const signature = await solanaAdapter.sendTransaction(signedTx);
        
        await solanaAdapter.confirmTransaction(signature);
        
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