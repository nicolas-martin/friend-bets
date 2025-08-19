import { useQuery } from '@tanstack/react-query';

import { Position } from '@/lib/grpc';
import { grpcClient } from '@/lib/grpc';

export function usePosition(marketId?: string, ownerAddress?: string) {
  return useQuery({
    queryKey: ['position', marketId, ownerAddress],
    queryFn: async (): Promise<Position | null> => {
      if (!marketId || !ownerAddress) return null;

      try {
        // Use the new getPosition endpoint
        const response = await grpcClient.getPosition({ 
          marketId, 
          owner: ownerAddress 
        });
        return response.position;
      } catch (error) {
        console.error('Failed to fetch position:', error);
        
        // If position doesn't exist, return null instead of throwing
        if (error instanceof Error && error.message.includes('not found')) {
          return null;
        }
        
        throw new Error('Failed to load position');
      }
    },
    enabled: !!marketId && !!ownerAddress,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 45 * 1000, // Refetch every 45 seconds
    retry: 1, // Only retry once for position queries
  });
}

export function useUserPositions(ownerAddress?: string) {
  return useQuery({
    queryKey: ['positions', 'user', ownerAddress],
    queryFn: async (): Promise<Position[]> => {
      if (!ownerAddress) return [];

      try {
        // Use the new getUserPositions endpoint
        const response = await grpcClient.getUserPositions({ owner: ownerAddress });
        return response.positions || [];
      } catch (error) {
        console.error('Failed to fetch user positions:', error);
        throw new Error('Failed to load your betting positions');
      }
    },
    enabled: !!ownerAddress,
    staleTime: 45 * 1000, // 45 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}