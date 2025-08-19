import { View, ViewStyle } from 'react-native';
import { Card, Text, Surface, Chip } from 'react-native-paper';

import { StatusChip } from './StatusChip';
import { OddsPill } from './OddsPill';
import { Countdown } from './Countdown';
import { Market, MarketStatus } from '@/lib/grpc';

interface MarketCardProps {
  market: Market;
  onPress?: () => void;
  style?: ViewStyle;
}

export function MarketCard({ market, onPress, style }: MarketCardProps) {
  const totalStaked = (market.stakedA || 0) + (market.stakedB || 0);
  const sideAPercent = totalStaked > 0 ? (market.stakedA / totalStaked) * 100 : 50;
  const sideBPercent = totalStaked > 0 ? (market.stakedB / totalStaked) * 100 : 50;

  const sideAOdds = totalStaked > 0 ? totalStaked / (market.stakedA || 1) : 1;
  const sideBOdds = totalStaked > 0 ? totalStaked / (market.stakedB || 1) : 1;

  return (
    <Card
      mode="elevated"
      onPress={onPress}
      style={[
        {
          marginBottom: 12,
        },
        style,
      ]}
    >
      <Card.Content>
        {/* Header */}
        <View style={{ 
          flexDirection: 'row', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start',
          marginBottom: 12,
        }}>
          <Text 
            variant="titleMedium" 
            numberOfLines={2}
            style={{ flex: 1, marginRight: 12 }}
          >
            {market.title}
          </Text>
          <StatusChip status={market.status} />
        </View>

        {/* Creator Info */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text variant="bodySmall" style={{ color: '#666', marginRight: 4 }}>
            by
          </Text>
          <Text variant="bodySmall" style={{ fontFamily: 'monospace', color: '#666' }}>
            {market.creator.slice(0, 8)}...{market.creator.slice(-4)}
          </Text>
          <Chip size="small" style={{ marginLeft: 8 }}>
            {(market.feeBps / 100)}% fee
          </Chip>
        </View>

        {/* Pool Visualization */}
        <View style={{ marginBottom: 12 }}>
          <View style={{ 
            flexDirection: 'row', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="bodyMedium" style={{ marginRight: 8 }}>
                Side A
              </Text>
              <OddsPill odds={sideAOdds} />
            </View>
            <Text variant="bodySmall" style={{ color: '#666' }}>
              {sideAPercent.toFixed(1)}%
            </Text>
          </View>

          <Surface style={{ 
            height: 4, 
            backgroundColor: '#e0e0e0', 
            borderRadius: 2,
            overflow: 'hidden',
            marginBottom: 6,
          }}>
            <View style={{
              width: `${sideAPercent}%`,
              height: '100%',
              backgroundColor: '#2196f3',
            }} />
          </Surface>

          <View style={{ 
            flexDirection: 'row', 
            justifyContent: 'space-between', 
            alignItems: 'center',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="bodyMedium" style={{ marginRight: 8 }}>
                Side B
              </Text>
              <OddsPill odds={sideBOdds} />
            </View>
            <Text variant="bodySmall" style={{ color: '#666' }}>
              {sideBPercent.toFixed(1)}%
            </Text>
          </View>

          <Surface style={{ 
            height: 4, 
            backgroundColor: '#e0e0e0', 
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <View style={{
              width: `${sideBPercent}%`,
              height: '100%',
              backgroundColor: '#ff5722',
            }} />
          </Surface>
        </View>

        {/* Footer */}
        <View style={{ 
          flexDirection: 'row', 
          justifyContent: 'space-between', 
          alignItems: 'center',
        }}>
          <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
            {(totalStaked / Math.pow(10, 6)).toLocaleString()} USDC
          </Text>
          
          {market.status === MarketStatus.MARKET_STATUS_OPEN && (
            <Countdown 
              endTime={market.endTs * 1000}
              compact
            />
          )}
          
          {market.status === MarketStatus.MARKET_STATUS_RESOLVED && market.outcome && (
            <Chip size="small" style={{ backgroundColor: '#4caf50' }}>
              Side {market.outcome === 'SIDE_A' ? 'A' : 'B'} Won
            </Chip>
          )}
        </View>
      </Card.Content>
    </Card>
  );
}