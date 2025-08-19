import { useQuery } from '@tanstack/react-query';

import { Market } from '@/lib/grpc';
import { grpcClient } from '@/lib/grpc';

export function useMarket(marketId?: string) {
  return useQuery({
    queryKey: ['market', marketId],
    queryFn: async (): Promise<Market | null> => {
      if (!marketId) return null;

      try {
        // Use the new direct getMarket endpoint
        const response = await grpcClient.getMarket({ marketId });
        return response.market;
      } catch (error) {
        console.error('Failed to fetch market:', error);
        
        // Check if it's a not found error
        if (error instanceof Error && error.message.includes('not found')) {
          throw new Error(`Market with ID ${marketId} not found`);
        }
        
        throw new Error('Failed to load market details');
      }
    },
    enabled: !!marketId,
    staleTime: 15 * 1000, // 15 seconds
    refetchInterval: 30 * 1000, // Refetch every 30 seconds for live updates
    retry: (failureCount, error) => {
      // Don't retry if market not found
      if (error instanceof Error && error.message.includes('not found')) {
        return false;
      }
      
      // Retry up to 3 times for other errors
      return failureCount < 3;
    },
  });
}

export function useMarketEvents(marketId?: string) {
  return useQuery({
    queryKey: ['market-events', marketId],
    queryFn: async () => {
      if (!marketId) return [];

      try {
        // This would be a streaming connection in a real implementation
        // For now, we'll return empty array as events aren't implemented in this demo
        return [];
      } catch (error) {
        console.error('Failed to fetch market events:', error);
        return [];
      }
    },
    enabled: !!marketId,
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: 15 * 1000, // Frequent updates for events
  });
}