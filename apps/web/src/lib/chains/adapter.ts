import { Transaction, PublicKey } from '@solana/web3.js';

/**
 * Abstract chain adapter interface for supporting multiple blockchains
 */
export interface ChainAdapter {
  // Chain identification
  chainId: string;
  chainName: string;
  
  // Native token info
  nativeTokenSymbol: string;
  nativeTokenDecimals: number;
  
  // Transaction handling
  deserializeTransaction(base64Tx: string): Promise<Transaction>;
  sendTransaction(signedTx: Transaction): Promise<string>;
  confirmTransaction(signature: string): Promise<void>;
  
  // Account/address utilities
  isValidAddress(address: string): boolean;
  normalizeAddress(address: string): string;
  
  // Token utilities
  getTokenDecimals(mintAddress: string): Promise<number>;
  getTokenBalance(walletAddress: string, mintAddress?: string): Promise<number>;
  
  // Program/contract utilities
  getProgramAddress(): PublicKey;
  deriveMarketAddress(creator: string, mint: string): Promise<string>;
  derivePositionAddress(market: string, owner: string): Promise<string>;
  
  // Market data
  fetchMarketData(marketAddress: string): Promise<any>;
  fetchPositionData(positionAddress: string): Promise<any>;
  
  // Calculation utilities
  calculateOdds(marketData: any): { sideAOdds: number; sideBOdds: number };
  calculatePayout(marketData: any, side: 'A' | 'B', amount: number): number;
  estimateGasFee(transaction: Transaction): Promise<number>;
}

/**
 * Chain adapter error types
 */
export class ChainAdapterError extends Error {
  constructor(
    message: string, 
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'ChainAdapterError';
  }
}

export class TransactionError extends ChainAdapterError {
  constructor(message: string, public signature?: string, cause?: unknown) {
    super(message, 'TRANSACTION_ERROR', cause);
  }
}

export class NetworkError extends ChainAdapterError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NETWORK_ERROR', cause);
  }
}

export class InvalidAddressError extends ChainAdapterError {
  constructor(address: string) {
    super(`Invalid address: ${address}`, 'INVALID_ADDRESS');
  }
}

/**
 * Chain adapter registry for managing multiple chains
 */
export class ChainAdapterRegistry {
  private adapters = new Map<string, ChainAdapter>();
  private defaultChain?: string;
  
  register(adapter: ChainAdapter, isDefault = false): void {
    this.adapters.set(adapter.chainId, adapter);
    
    if (isDefault || this.adapters.size === 1) {
      this.defaultChain = adapter.chainId;
    }
  }
  
  get(chainId?: string): ChainAdapter {
    const targetChain = chainId || this.defaultChain;
    
    if (!targetChain) {
      throw new ChainAdapterError('No chain specified and no default chain set', 'NO_CHAIN');
    }
    
    const adapter = this.adapters.get(targetChain);
    if (!adapter) {
      throw new ChainAdapterError(`Chain adapter not found: ${targetChain}`, 'ADAPTER_NOT_FOUND');
    }
    
    return adapter;
  }
  
  list(): ChainAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  getDefault(): ChainAdapter | undefined {
    return this.defaultChain ? this.adapters.get(this.defaultChain) : undefined;
  }
}