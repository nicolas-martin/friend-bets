import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import {
  Text,
  Card,
  Button,
  Surface,
  ActivityIndicator,
  RadioButton,
  Divider,
  Dialog,
  Portal,
} from 'react-native-paper';
import { useWallet } from '@solana/wallet-adapter-react';

import { useMarket } from '@/hooks/useMarket';
import { useTx } from '@/hooks/useTx';
import { TxButton } from '@/components/TxButton';
import { StatusChip } from '@/components/StatusChip';
import { Countdown } from '@/components/Countdown';
import { MarketStatus, Side } from '@/lib/grpc';

export default function ResolveMarketScreen() {
  const router = useRouter();
  const { market: marketId } = useLocalSearchParams<{ market: string }>();
  const { connected, publicKey } = useWallet();
  
  const [selectedOutcome, setSelectedOutcome] = useState<'A' | 'B' | ''>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const {
    data: market,
    isLoading: marketLoading,
    error: marketError,
    refetch: refetchMarket,
  } = useMarket(marketId);

  const { resolveMarket, isLoading: txLoading } = useTx();

  const handleResolve = async () => {
    if (!connected || !publicKey || !market || !selectedOutcome) return;

    setShowConfirmDialog(false);
    
    try {
      await resolveMarket({
        marketId: market.id,
        outcome: selectedOutcome === 'A' ? Side.SIDE_A : Side.SIDE_B,
      });
      
      refetchMarket();
      router.replace(`/market/${marketId}`);
    } catch (error) {
      console.error('Failed to resolve market:', error);
    }
  };

  // Check permissions
  const canResolve = market && 
    market.status === MarketStatus.MARKET_STATUS_PENDING_RESOLVE &&
    market.creator === publicKey?.toString();

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
          The market you're trying to resolve doesn't exist or couldn't be loaded.
        </Text>
        <Button mode="contained" onPress={() => router.back()}>
          Go Back
        </Button>
      </View>
    );
  }

  if (!connected) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text variant="headlineSmall" style={{ marginBottom: 16, textAlign: 'center' }}>
          Wallet Connection Required
        </Text>
        <Text variant="bodyMedium" style={{ marginBottom: 24, textAlign: 'center' }}>
          You need to connect your wallet to resolve markets.
        </Text>
        <Button mode="contained" onPress={() => router.push('/wallet')}>
          Connect Wallet
        </Button>
      </View>
    );
  }

  if (!canResolve) {
    let message = 'You cannot resolve this market.';
    
    if (market.creator !== publicKey?.toString()) {
      message = 'Only the market creator can resolve this market.';
    } else if (market.status !== MarketStatus.MARKET_STATUS_PENDING_RESOLVE) {
      message = 'This market is not ready for resolution.';
    }

    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text variant="titleMedium" style={{ marginBottom: 16, textAlign: 'center' }}>
          Cannot Resolve Market
        </Text>
        <Text variant="bodyMedium" style={{ marginBottom: 24, textAlign: 'center' }}>
          {message}
        </Text>
        <Button mode="contained" onPress={() => router.back()}>
          Go Back
        </Button>
      </View>
    );
  }

  const totalStaked = (market.stakedA || 0) + (market.stakedB || 0);
  const feeAmount = (totalStaked * market.feeBps) / 10000;
  const distributable = totalStaked - feeAmount;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <View style={{ padding: 16 }}>
        {/* Market Summary */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleLarge" style={{ marginBottom: 12 }}>
              {market.title}
            </Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <StatusChip status={market.status} />
              <Countdown 
                endTime={market.resolveDeadlineTs * 1000}
                label="Deadline in"
                style={{ marginLeft: 12 }}
                compact
              />
            </View>

            <Text variant="bodyMedium" style={{ color: '#666', marginBottom: 16 }}>
              As the market creator, you need to determine the winning outcome based on real-world results.
            </Text>

            <Surface style={{ 
              padding: 16, 
              borderRadius: 8, 
              backgroundColor: '#fff3e0',
              marginBottom: 16,
            }}>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold', marginBottom: 8 }}>
                Important:
              </Text>
              <Text variant="bodySmall">
                • Resolution is permanent and cannot be changed
              </Text>
              <Text variant="bodySmall">
                • You will earn {(market.feeBps / 100)}% of the total pool as creator fee
              </Text>
              <Text variant="bodySmall">
                • Failure to resolve by deadline will result in market cancellation
              </Text>
            </Surface>
          </Card.Content>
        </Card>

        {/* Pool Breakdown */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Pool Breakdown
            </Text>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text variant="bodyMedium">Side A Stake:</Text>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                {(market.stakedA / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text variant="bodyMedium">Side B Stake:</Text>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                {(market.stakedB / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>

            <Divider style={{ marginVertical: 12 }} />
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text variant="bodyMedium">Total Pool:</Text>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                {(totalStaked / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text variant="bodyMedium">Creator Fee ({(market.feeBps / 100)}%):</Text>
              <Text variant="bodyMedium" style={{ color: '#4caf50', fontWeight: 'bold' }}>
                {(feeAmount / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodyMedium">To Winners:</Text>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                {(distributable / Math.pow(10, 6)).toLocaleString()} USDC
              </Text>
            </View>
          </Card.Content>
        </Card>

        {/* Resolution Selection */}
        <Card style={{ marginBottom: 24 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Select Winning Outcome
            </Text>
            
            <Surface style={{ 
              padding: 16, 
              borderRadius: 8,
              backgroundColor: selectedOutcome === 'A' ? '#e3f2fd' : 'transparent',
              borderWidth: selectedOutcome === 'A' ? 2 : 1,
              borderColor: selectedOutcome === 'A' ? '#2196f3' : '#e0e0e0',
              marginBottom: 12,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RadioButton
                  value="A"
                  status={selectedOutcome === 'A' ? 'checked' : 'unchecked'}
                  onPress={() => setSelectedOutcome('A')}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="titleMedium" style={{ marginBottom: 4 }}>
                    Side A Wins
                  </Text>
                  <Text variant="bodyMedium" style={{ color: '#666' }}>
                    {market.stakedA > 0 ? 'Side A participants win' : 'No Side A bets placed'}
                  </Text>
                  {selectedOutcome === 'A' && market.stakedA > 0 && (
                    <Text variant="bodySmall" style={{ 
                      color: '#4caf50',
                      fontWeight: 'bold',
                      marginTop: 8,
                    }}>
                      Winners get {((distributable / market.stakedA) || 0).toFixed(2)}x their stake
                    </Text>
                  )}
                </View>
              </View>
            </Surface>

            <Surface style={{ 
              padding: 16, 
              borderRadius: 8,
              backgroundColor: selectedOutcome === 'B' ? '#e3f2fd' : 'transparent',
              borderWidth: selectedOutcome === 'B' ? 2 : 1,
              borderColor: selectedOutcome === 'B' ? '#2196f3' : '#e0e0e0',
              marginBottom: 16,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RadioButton
                  value="B"
                  status={selectedOutcome === 'B' ? 'checked' : 'unchecked'}
                  onPress={() => setSelectedOutcome('B')}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="titleMedium" style={{ marginBottom: 4 }}>
                    Side B Wins
                  </Text>
                  <Text variant="bodyMedium" style={{ color: '#666' }}>
                    {market.stakedB > 0 ? 'Side B participants win' : 'No Side B bets placed'}
                  </Text>
                  {selectedOutcome === 'B' && market.stakedB > 0 && (
                    <Text variant="bodySmall" style={{ 
                      color: '#4caf50',
                      fontWeight: 'bold',
                      marginTop: 8,
                    }}>
                      Winners get {((distributable / market.stakedB) || 0).toFixed(2)}x their stake
                    </Text>
                  )}
                </View>
              </View>
            </Surface>

            <TxButton
              mode="contained"
              onPress={() => setShowConfirmDialog(true)}
              disabled={!selectedOutcome}
              loading={txLoading}
              style={{ backgroundColor: '#ff6b6b' }}
            >
              Resolve Market
            </TxButton>
          </Card.Content>
        </Card>
      </View>

      {/* Confirmation Dialog */}
      <Portal>
        <Dialog visible={showConfirmDialog} onDismiss={() => setShowConfirmDialog(false)}>
          <Dialog.Title>Confirm Resolution</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
              Are you sure you want to resolve this market with the outcome:
            </Text>
            <Text variant="titleMedium" style={{ 
              textAlign: 'center',
              color: '#2196f3',
              fontWeight: 'bold',
              marginBottom: 16,
            }}>
              Side {selectedOutcome} Wins
            </Text>
            <Text variant="bodySmall" style={{ color: '#666' }}>
              This action cannot be undone. Winners will be able to claim their payouts immediately.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              onPress={handleResolve}
              disabled={txLoading}
              style={{ backgroundColor: '#ff6b6b' }}
            >
              Confirm Resolution
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}