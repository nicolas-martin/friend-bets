import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useOnChainMarket } from '@/hooks/useOnChainMarket';
import { useOnChainPosition } from '@/hooks/useOnChainPosition';

interface OnChainTestProps {
  marketId: string;
  userAddress?: string;
}

export function OnChainTest({ marketId, userAddress }: OnChainTestProps) {
  const { data: market, isLoading: marketLoading, error: marketError } = useOnChainMarket(marketId);
  const { data: position, isLoading: positionLoading } = useOnChainPosition(
    marketId, 
    userAddress || ''
  );

  if (marketLoading) {
    return <Text>Loading market data...</Text>;
  }

  if (marketError) {
    return <Text style={styles.error}>Error loading market: {String(marketError)}</Text>;
  }

  if (!market) {
    return <Text style={styles.error}>Market not found</Text>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔗 On-Chain Market Data</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Market Info</Text>
        <Text>Market ID: {market.marketId}</Text>
        <Text>Title: {market.title}</Text>
        <Text>Creator: {market.creator.slice(0, 8)}...</Text>
        <Text>Status: {market.status === 1 ? 'Open' : 'Other'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Staking</Text>
        <Text>💰 Total Staked: {(market.totalStaked / 1000000).toFixed(2)} USDC</Text>
        <Text>🔵 Side A: {(market.stakedA / 1000000).toFixed(2)} USDC ({(market.oddsB * 100).toFixed(1)}%)</Text>
        <Text>🔴 Side B: {(market.stakedB / 1000000).toFixed(2)} USDC ({(market.oddsA * 100).toFixed(1)}%)</Text>
      </View>

      {userAddress && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Position</Text>
          {positionLoading ? (
            <Text>Loading position...</Text>
          ) : position ? (
            <>
              <Text>✅ You have a position!</Text>
              <Text>Side: {position.side}</Text>
              <Text>Amount: {(position.amount / 1000000).toFixed(2)} USDC</Text>
              <Text>Claimed: {position.claimed ? 'Yes' : 'No'}</Text>
              <Text>PDA: {position.positionPda.slice(0, 8)}...</Text>
            </>
          ) : (
            <Text>❌ No position found</Text>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Raw Data</Text>
        <Text style={styles.small}>Staked A: {market.stakedA}</Text>
        <Text style={styles.small}>Staked B: {market.stakedB}</Text>
        <Text style={styles.small}>Outcome: {market.outcome ?? 'None'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    margin: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  section: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  error: {
    color: 'red',
    textAlign: 'center',
    padding: 16,
  },
  small: {
    fontSize: 12,
    color: '#666',
  },
});