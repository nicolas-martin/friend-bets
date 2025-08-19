import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScrollView, View, RefreshControl } from 'react-native';
import {
  Text,
  Card,
  Button,
  Surface,
  ActivityIndicator,
  Divider,
  Chip,
  IconButton,
} from 'react-native-paper';
import { useWallet } from '@solana/wallet-adapter-react';

import { useMarket } from '@/hooks/useMarket';
import { usePosition } from '@/hooks/usePosition';
import { useTx } from '@/hooks/useTx';
import { useOddsPreview } from '@/hooks/useOddsPreview';
import { MarketCard } from '@/components/MarketCard';
import { StatusChip } from '@/components/StatusChip';
import { OddsPill } from '@/components/OddsPill';
import { TokenAmountInput } from '@/components/TokenAmountInput';
import { SideSelector } from '@/components/SideSelector';
import { Countdown } from '@/components/Countdown';
import { TxButton } from '@/components/TxButton';
import { CopyField } from '@/components/CopyField';
import { MarketStatus, Side } from '@/lib/grpc';
import { BET_SIDE_A, BET_SIDE_B, betSideToString } from '@/lib/chains/solana';

export default function MarketDetailScreen() {
  const router = useRouter();
  const { market: marketId } = useLocalSearchParams<{ market: string }>();
  const { connected, publicKey } = useWallet();
  
  const [selectedSide, setSelectedSide] = useState<'A' | 'B'>('A');
  const [betAmount, setBetAmount] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    data: market,
    isLoading: marketLoading,
    error: marketError,
    refetch: refetchMarket,
    isRefetching: marketRefetching,
  } = useMarket(marketId);

  const {
    data: position,
    isLoading: positionLoading,
    refetch: refetchPosition,
  } = usePosition(marketId, publicKey?.toString());

  const { placeBet, claim, isLoading: txLoading } = useTx();
  
  const { 
    payout, 
    odds, 
    isValid 
  } = useOddsPreview(
    market, 
    selectedSide === 'A' ? BET_SIDE_A : BET_SIDE_B, 
    betAmount
  );

  const handlePlaceBet = async () => {
    if (!connected || !publicKey || !market || !isValid) return;

    try {
      await placeBet({
        marketId: market.id,
        side: selectedSide === 'A' ? Side.SIDE_A : Side.SIDE_B,
        amount: parseInt(betAmount) * Math.pow(10, 6), // Assume 6 decimals
      });
      
      setBetAmount('');
      refetchMarket();
      refetchPosition();
    } catch (error) {
      console.error('Failed to place bet:', error);
    }
  };

  const handleClaim = async () => {
    if (!connected || !publicKey || !market) return;

    try {
      await claim({ marketId: market.id });
      refetchPosition();
    } catch (error) {
      console.error('Failed to claim:', error);
    }
  };

  const handleResolve = () => {
    router.push(`/resolve/${marketId}`);
  };

  const canBet = market?.status === MarketStatus.MARKET_STATUS_OPEN && connected;
  const canClaim = position && !position.claimed && 
    (market?.status === MarketStatus.MARKET_STATUS_RESOLVED || 
     market?.status === MarketStatus.MARKET_STATUS_CANCELLED);
  const canResolve = market?.status === MarketStatus.MARKET_STATUS_PENDING_RESOLVE && 
    market.creator === publicKey?.toString();

  const isCreator = market?.creator === publicKey?.toString();

  if (marketLoading && !market) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 16 }}>Loading market...</Text>
      </View>
    );
  }

  if (marketError || !market) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text variant="titleMedium" style={{ marginBottom: 16 }}>
          Market not found
        </Text>
        <Text variant="bodyMedium" style={{ marginBottom: 16, textAlign: 'center' }}>
          The market you're looking for doesn't exist or couldn't be loaded.
        </Text>
        <Button mode="contained" onPress={() => router.back()}>
          Go Back
        </Button>
      </View>
    );
  }

  const totalStaked = (market.stakedA || 0) + (market.stakedB || 0);
  const sideAPercent = totalStaked > 0 ? (market.stakedA / totalStaked) * 100 : 50;
  const sideBPercent = totalStaked > 0 ? (market.stakedB / totalStaked) * 100 : 50;

  return (
    <ScrollView 
      style={{ flex: 1, backgroundColor: '#f5f5f5' }}
      refreshControl={
        <RefreshControl
          refreshing={marketRefetching}
          onRefresh={refetchMarket}
        />
      }
    >
      <View style={{ padding: 16 }}>
        {/* Market Header */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <Text variant="titleLarge" style={{ flex: 1, marginRight: 12 }}>
                {market.title}
              </Text>
              <StatusChip status={market.status} />
            </View>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text variant="bodySmall" style={{ color: '#666' }}>
                Created by: 
              </Text>
              <Text variant="bodySmall" style={{ marginLeft: 4, fontFamily: 'monospace' }}>
                {market.creator.slice(0, 8)}...
              </Text>
              {isCreator && (
                <Chip size="small" style={{ marginLeft: 8 }}>
                  Your Market
                </Chip>
              )}
            </View>

            {market.status === MarketStatus.MARKET_STATUS_OPEN && (
              <Countdown 
                endTime={market.endTs * 1000}
                label="Betting ends in"
              />
            )}

            {market.status === MarketStatus.MARKET_STATUS_PENDING_RESOLVE && (
              <Countdown 
                endTime={market.resolveDeadlineTs * 1000}
                label="Resolve deadline in"
              />
            )}
          </Card.Content>
        </Card>

        {/* Pool Status */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Pool Status
            </Text>
            
            <View style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">Side A</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text variant="bodyMedium">{sideAPercent.toFixed(1)}%</Text>
                  <OddsPill 
                    odds={totalStaked > 0 ? totalStaked / (market.stakedA || 1) : 1} 
                    style={{ marginLeft: 8 }}
                  />
                </View>
              </View>
              <Surface style={{ 
                height: 6, 
                backgroundColor: '#e0e0e0', 
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <View style={{
                  width: `${sideAPercent}%`,
                  height: '100%',
                  backgroundColor: '#2196f3',
                }} />
              </Surface>
            </View>

            <View style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">Side B</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text variant="bodyMedium">{sideBPercent.toFixed(1)}%</Text>
                  <OddsPill 
                    odds={totalStaked > 0 ? totalStaked / (market.stakedB || 1) : 1} 
                    style={{ marginLeft: 8 }}
                  />
                </View>
              </View>
              <Surface style={{ 
                height: 6, 
                backgroundColor: '#e0e0e0', 
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <View style={{
                  width: `${sideBPercent}%`,
                  height: '100%',
                  backgroundColor: '#ff5722',
                }} />
              </Surface>
            </View>

            <Divider style={{ marginVertical: 12 }} />
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodyMedium">Total Pool:</Text>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                {(totalStaked / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text variant="bodySmall" style={{ color: '#666' }}>
                Creator Fee: {(market.feeBps / 100)}%
              </Text>
            </View>
          </Card.Content>
        </Card>

        {/* User Position */}
        {position && (
          <Card style={{ marginBottom: 16 }}>
            <Card.Content>
              <Text variant="titleMedium" style={{ marginBottom: 12 }}>
                Your Position
              </Text>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">Side:</Text>
                <Chip size="small">
                  Side {betSideToString(position.side)}
                </Chip>
              </View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">Amount:</Text>
                <Text variant="bodyMedium">
                  {(position.amount / Math.pow(10, 6)).toLocaleString()} USDC
                </Text>
              </View>

              {canClaim && (
                <TxButton
                  mode="contained"
                  onPress={handleClaim}
                  loading={txLoading}
                  style={{ marginTop: 12 }}
                >
                  {market?.status === MarketStatus.MARKET_STATUS_CANCELLED 
                    ? 'Claim Refund' 
                    : 'Claim Winnings'}
                </TxButton>
              )}
            </Card.Content>
          </Card>
        )}

        {/* Betting Interface */}
        {canBet && (
          <Card style={{ marginBottom: 16 }}>
            <Card.Content>
              <Text variant="titleMedium" style={{ marginBottom: 16 }}>
                Place Bet
              </Text>
              
              <SideSelector
                selectedSide={selectedSide}
                onSideChange={setSelectedSide}
                sideAOdds={totalStaked > 0 ? totalStaked / (market.stakedA || 1) : 1}
                sideBOdds={totalStaked > 0 ? totalStaked / (market.stakedB || 1) : 1}
                style={{ marginBottom: 16 }}
              />
              
              <TokenAmountInput
                value={betAmount}
                onValueChange={setBetAmount}
                symbol="USDC"
                style={{ marginBottom: 16 }}
                disabled={txLoading}
              />
              
              {betAmount && isValid && (
                <Surface style={{ 
                  padding: 12, 
                  borderRadius: 8, 
                  backgroundColor: '#e8f5e8',
                  marginBottom: 16,
                }}>
                  <Text variant="bodyMedium" style={{ marginBottom: 4 }}>
                    Potential Payout: {(payout / Math.pow(10, 6)).toFixed(2)} USDC
                  </Text>
                  <Text variant="bodySmall" style={{ color: '#666' }}>
                    Odds: {odds.toFixed(2)}x
                  </Text>
                </Surface>
              )}
              
              <TxButton
                mode="contained"
                onPress={handlePlaceBet}
                disabled={!isValid || !betAmount}
                loading={txLoading}
              >
                Place Bet
              </TxButton>
            </Card.Content>
          </Card>
        )}

        {/* Resolution Action */}
        {canResolve && (
          <Card style={{ marginBottom: 16 }}>
            <Card.Content>
              <Text variant="titleMedium" style={{ marginBottom: 12 }}>
                Resolve Market
              </Text>
              <Text variant="bodyMedium" style={{ marginBottom: 16, color: '#666' }}>
                As the creator, you need to resolve this market by selecting the winning outcome.
              </Text>
              <Button 
                mode="contained"
                onPress={handleResolve}
                style={{ backgroundColor: '#ff6b6b' }}
              >
                Resolve Market
              </Button>
            </Card.Content>
          </Card>
        )}

        {/* Advanced Info */}
        <Card style={{ marginBottom: 32 }}>
          <Card.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="titleMedium">Market Details</Text>
              <IconButton
                icon={showAdvanced ? 'chevron-up' : 'chevron-down'}
                onPress={() => setShowAdvanced(!showAdvanced)}
              />
            </View>
            
            {showAdvanced && (
              <View style={{ marginTop: 16 }}>
                <CopyField
                  label="Market ID"
                  value={marketId || ''}
                  style={{ marginBottom: 12 }}
                />
                
                <CopyField
                  label="Creator Address"
                  value={market.creator}
                  style={{ marginBottom: 12 }}
                />

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text variant="bodyMedium">End Time:</Text>
                  <Text variant="bodyMedium">
                    {new Date(market.endTs * 1000).toLocaleString()}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text variant="bodyMedium">Resolve Deadline:</Text>
                  <Text variant="bodyMedium">
                    {new Date(market.resolveDeadlineTs * 1000).toLocaleString()}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="bodyMedium">Created:</Text>
                  <Text variant="bodyMedium">
                    {new Date(market.createdAt * 1000).toLocaleString()}
                  </Text>
                </View>
              </View>
            )}
          </Card.Content>
        </Card>
      </View>
    </ScrollView>
  );
}