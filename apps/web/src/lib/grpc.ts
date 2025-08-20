import { createClient, type Client } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

// Note: In a real implementation, you would import these from generated protobuf files
// For this implementation, we'll define the types based on the proto definitions

export enum Side {
  SIDE_UNSPECIFIED = 0,
  SIDE_A = 1,
  SIDE_B = 2,
}

export enum MarketStatus {
  MARKET_STATUS_UNSPECIFIED = 0,
  MARKET_STATUS_OPEN = 1,
  MARKET_STATUS_PENDING_RESOLVE = 2,
  MARKET_STATUS_RESOLVED = 3,
  MARKET_STATUS_CANCELLED = 4,
}

export interface Market {
  id: string;
  creator: string;
  mint: string;
  vault: string;
  feeBps: number;
  endTs: number;
  resolveDeadlineTs: number;
  stakedA: number;
  stakedB: number;
  status: MarketStatus;
  outcome?: Side;
  creatorFeeWithdrawn: boolean;
  title: string;
  createdAt: number;
}

export interface Position {
  id: string;
  marketId: string;
  owner: string;
  side: Side;
  amount: number;
  claimed: boolean;
  createdAt: number;
}

export interface ListMarketsRequest {
  titleFilter?: string;
  statusFilter?: MarketStatus;
  pageSize?: number;
  pageToken?: string;
}

export interface ListMarketsResponse {
  markets: Market[];
  nextPageToken?: string;
}

export interface GetMarketRequest {
  marketId: string;
}

export interface GetMarketResponse {
  market: Market;
}

export interface CreateMarketRequest {
  feeBps: number;
  endTs: number;
  resolveDeadlineTs: number;
  title: string;
  creator: string;
  mint: string;
}

export interface CreateMarketResponse {
  marketId: string;
  unsignedTxBase64?: string;
  signature?: string;
}

export interface PlaceBetRequest {
  marketId: string;
  owner: string;
  side: Side;
  amount: number;
}

export interface PlaceBetResponse {
  positionId: string;
  unsignedTxBase64?: string;
  signature?: string;
}

export interface GetPositionRequest {
  marketId: string;
  owner: string;
}

export interface GetPositionResponse {
  position: Position;
}

export interface GetUserPositionsRequest {
  owner: string;
  pageSize?: number;
  pageToken?: string;
}

export interface GetUserPositionsResponse {
  positions: Position[];
  nextPageToken?: string;
}

export interface ResolveRequest {
  marketId: string;
  resolver: string;
  outcome: Side;
}

export interface ResolveResponse {
  unsignedTxBase64?: string;
  signature?: string;
}

export interface ClaimRequest {
  marketId: string;
  owner: string;
}

export interface ClaimResponse {
  payoutAmount?: number;
  unsignedTxBase64?: string;
  signature?: string;
}

export interface ConfirmMarketRequest {
  txSignature: string;
  creator: string;
  mint: string;
  feeBps: number;
  endTs: number;
  resolveDeadlineTs: number;
  title: string;
}

export interface ConfirmMarketResponse {
  marketId: string;
  success: boolean;
}

export interface WatchEventsRequest {
  marketIds?: string[];
}

export interface MarketEvent {
  id: string;
  marketId: string;
  eventType: string;
  data: string;
  timestamp: number;
  txSignature: string;
}

export interface WatchEventsResponse {
  event: MarketEvent;
}

// BetsService interface - this would normally be generated from protobuf
export interface BetsService {
  listMarkets(request: ListMarketsRequest): Promise<ListMarketsResponse>;
  getMarket(request: GetMarketRequest): Promise<GetMarketResponse>;
  createMarket(request: CreateMarketRequest): Promise<CreateMarketResponse>;
  confirmMarket(request: ConfirmMarketRequest): Promise<ConfirmMarketResponse>;
  placeBet(request: PlaceBetRequest): Promise<PlaceBetResponse>;
  getPosition(request: GetPositionRequest): Promise<GetPositionResponse>;
  getUserPositions(request: GetUserPositionsRequest): Promise<GetUserPositionsResponse>;
  resolve(request: ResolveRequest): Promise<ResolveResponse>;
  claim(request: ClaimRequest): Promise<ClaimResponse>;
  // Note: watchEvents would be a streaming method in real implementation
}

// Real gRPC client implementation
class ConnectBetsService implements BetsService {
  private client: any; // This would be the generated Connect client
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    
    // Create the transport
    const transport = createConnectTransport({
      baseUrl,
      // Add any authentication headers here if needed
      interceptors: [
        (next) => async (req) => {
          // Add authentication header if available
          const token = localStorage.getItem('auth_token');
          if (token) {
            req.header.set('Authorization', `Bearer ${token}`);
          }
          return await next(req);
        },
      ],
    });

    // In a real implementation, this would be the generated client:
    // this.client = createClient(BetsService, transport);
    
    // For now, we'll make direct HTTP requests
    this.client = {
      transport,
      makeRequest: async (method: string, data: any) => {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${baseUrl}/bets.v1.BetsService/${method}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`gRPC error: ${response.status} ${errorText}`);
        }

        return await response.json();
      },
    };
  }

  async listMarkets(request: ListMarketsRequest): Promise<ListMarketsResponse> {
    try {
      const response = await this.client.makeRequest('ListMarkets', {
        titleFilter: request.titleFilter || '',
        statusFilter: request.statusFilter || MarketStatus.MARKET_STATUS_UNSPECIFIED,
        pageSize: request.pageSize || 20,
        pageToken: request.pageToken || '',
      });

      return {
        markets: response.markets || [],
        nextPageToken: response.nextPageToken,
      };
    } catch (error) {
      console.error('Failed to list markets:', error);
      throw new Error('Failed to load markets');
    }
  }

  async getMarket(request: GetMarketRequest): Promise<GetMarketResponse> {
    try {
      const response = await this.client.makeRequest('GetMarket', {
        marketId: request.marketId,
      });

      return {
        market: response.market,
      };
    } catch (error) {
      console.error('Failed to get market:', error);
      throw new Error('Failed to load market');
    }
  }

  async createMarket(request: CreateMarketRequest): Promise<CreateMarketResponse> {
    try {
      const response = await this.client.makeRequest('CreateMarket', request);
      return response;
    } catch (error) {
      console.error('Failed to create market:', error);
      throw new Error('Failed to create market');
    }
  }

  async confirmMarket(request: ConfirmMarketRequest): Promise<ConfirmMarketResponse> {
    try {
      const response = await this.client.makeRequest('ConfirmMarket', request);
      return response;
    } catch (error) {
      console.error('Failed to confirm market:', error);
      throw new Error('Failed to confirm market');
    }
  }

  async placeBet(request: PlaceBetRequest): Promise<PlaceBetResponse> {
    try {
      const response = await this.client.makeRequest('PlaceBet', request);
      return response;
    } catch (error) {
      console.error('Failed to place bet:', error);
      throw new Error('Failed to place bet');
    }
  }

  async getPosition(request: GetPositionRequest): Promise<GetPositionResponse> {
    try {
      const response = await this.client.makeRequest('GetPosition', request);
      return response;
    } catch (error) {
      console.error('Failed to get position:', error);
      throw new Error('Failed to load position');
    }
  }

  async getUserPositions(request: GetUserPositionsRequest): Promise<GetUserPositionsResponse> {
    try {
      const response = await this.client.makeRequest('GetUserPositions', {
        owner: request.owner,
        pageSize: request.pageSize || 20,
        pageToken: request.pageToken || '',
      });

      return {
        positions: response.positions || [],
        nextPageToken: response.nextPageToken,
      };
    } catch (error) {
      console.error('Failed to get user positions:', error);
      throw new Error('Failed to load your positions');
    }
  }

  async resolve(request: ResolveRequest): Promise<ResolveResponse> {
    try {
      const response = await this.client.makeRequest('Resolve', request);
      return response;
    } catch (error) {
      console.error('Failed to resolve market:', error);
      throw new Error('Failed to resolve market');
    }
  }

  async claim(request: ClaimRequest): Promise<ClaimResponse> {
    try {
      const response = await this.client.makeRequest('Claim', request);
      return response;
    } catch (error) {
      console.error('Failed to claim winnings:', error);
      throw new Error('Failed to claim winnings');
    }
  }
}

// Create and export the gRPC client
const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080';
export const grpcClient = new ConnectBetsService(baseUrl);

// Helper function to convert timestamp to Date
export function timestampToDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}

// Helper function to convert Date to timestamp
export function dateToTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}