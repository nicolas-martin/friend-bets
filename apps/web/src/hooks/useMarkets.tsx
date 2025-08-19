import { useQuery } from '@tanstack/react-query';

import { Market, MarketStatus } from '@/lib/grpc';
import { grpcClient } from '@/lib/grpc';

interface UseMarketsOptions {
  titleFilter?: string;
  statusFilter?: MarketStatus;
  pageSize?: number;
}

export function useMarkets({
  titleFilter = '',
  statusFilter,
  pageSize = 50,
}: UseMarketsOptions = {}) {
  return useQuery({
    queryKey: ['markets', titleFilter, statusFilter, pageSize],
    queryFn: async (): Promise<Market[]> => {
      const request = {
        titleFilter,
        statusFilter: statusFilter || undefined,
        pageSize,
        pageToken: '',
      };

      try {
        const response = await grpcClient.listMarkets(request);
        return response.markets || [];
      } catch (error) {
        console.error('Failed to fetch markets:', error);
        throw new Error('Failed to load markets');
      }
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
    retry: (failureCount, error) => {
      // Retry up to 3 times for network errors
      if (failureCount < 3) {
        console.log(`Retrying markets fetch (${failureCount + 1}/3)`);
        return true;
      }
      return false;
    },
  });
}

export function useMarketsByCreator(creatorAddress?: string) {
  return useQuery({
    queryKey: ['markets', 'creator', creatorAddress],
    queryFn: async (): Promise<Market[]> => {
      if (!creatorAddress) return [];

      const request = {
        titleFilter: '',
        statusFilter: undefined,
        pageSize: 100,
        pageToken: '',
      };

      try {
        const response = await grpcClient.listMarkets(request);
        // Filter by creator on client side since gRPC doesn't support creator filtering
        return (response.markets || []).filter(
          market => market.creator === creatorAddress
        );
      } catch (error) {
        console.error('Failed to fetch creator markets:', error);
        throw new Error('Failed to load your markets');
      }
    },
    enabled: !!creatorAddress,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}