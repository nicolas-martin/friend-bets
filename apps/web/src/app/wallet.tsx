import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import {
  Text,
  Card,
  Button,
  List,
  Avatar,
  Surface,
  Divider,
} from 'react-native-paper';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useEffect, useState } from 'react';

import { CopyField } from '@/components/CopyField';
import { TxButton } from '@/components/TxButton';

export default function WalletScreen() {
  const router = useRouter();
  const { connection } = useConnection();
  const { 
    wallet, 
    publicKey, 
    connected, 
    connecting, 
    disconnect,
    wallets,
    select,
  } = useWallet();
  const { setVisible } = useWalletModal();

  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  useEffect(() => {
    if (connected && publicKey) {
      fetchBalance();
    } else {
      setBalance(null);
    }
  }, [connected, publicKey]);

  const fetchBalance = async () => {
    if (!publicKey) return;
    
    setLoadingBalance(true);
    try {
      const lamports = await connection.getBalance(publicKey);
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
    setLoadingBalance(false);
  };

  const handleConnect = () => {
    setVisible(true);
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      router.back();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const handleWalletSelect = (walletName: string) => {
    const selectedWallet = wallets.find(w => w.adapter.name === walletName);
    if (selectedWallet) {
      select(selectedWallet.adapter.name);
    }
  };

  const getWalletIcon = (walletName: string) => {
    switch (walletName) {
      case 'Phantom':
        return 'ghost';
      case 'Solflare':
        return 'fire';
      case 'Backpack':
        return 'backpack';
      default:
        return 'wallet';
    }
  };

  if (connected && wallet && publicKey) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
        <View style={{ padding: 16 }}>
          {/* Connected Wallet Info */}
          <Card style={{ marginBottom: 16 }}>
            <Card.Content>
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Avatar.Icon 
                  size={64} 
                  icon={getWalletIcon(wallet.adapter.name)} 
                  style={{ marginBottom: 12, backgroundColor: '#4caf50' }}
                />
                <Text variant="titleLarge" style={{ marginBottom: 4 }}>
                  {wallet.adapter.name}
                </Text>
                <Text variant="bodyMedium" style={{ color: '#4caf50' }}>
                  Connected
                </Text>
              </View>

              <CopyField
                label="Wallet Address"
                value={publicKey.toString()}
                style={{ marginBottom: 16 }}
              />

              <Surface style={{ 
                padding: 16, 
                borderRadius: 8,
                backgroundColor: '#e8f5e8',
                marginBottom: 16,
              }}>
                <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 8 }}>
                  SOL Balance
                </Text>
                <Text variant="titleLarge" style={{ 
                  textAlign: 'center',
                  fontWeight: 'bold',
                  color: '#2e7d32',
                }}>
                  {loadingBalance ? 'Loading...' : 
                   balance !== null ? `${balance.toFixed(4)} SOL` : 'Failed to load'}
                </Text>
                <Button 
                  mode="text" 
                  onPress={fetchBalance}
                  disabled={loadingBalance}
                  style={{ marginTop: 8 }}
                >
                  Refresh Balance
                </Button>
              </Surface>

              <Button 
                mode="contained-tonal"
                onPress={handleDisconnect}
                style={{ backgroundColor: '#ffebee' }}
                textColor="#d32f2f"
              >
                Disconnect Wallet
              </Button>
            </Card.Content>
          </Card>

          {/* Actions */}
          <Card style={{ marginBottom: 16 }}>
            <Card.Content>
              <Text variant="titleMedium" style={{ marginBottom: 16 }}>
                Quick Actions
              </Text>
              
              <Button
                mode="contained"
                onPress={() => router.push('/create')}
                style={{ marginBottom: 12 }}
                icon="plus"
              >
                Create Market
              </Button>
              
              <Button
                mode="outlined"
                onPress={() => router.replace('/')}
                icon="home"
              >
                Browse Markets
              </Button>
            </Card.Content>
          </Card>

          {/* Wallet Info */}
          <Card>
            <Card.Content>
              <Text variant="titleMedium" style={{ marginBottom: 16 }}>
                Network Information
              </Text>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">Network:</Text>
                <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                  Solana Devnet
                </Text>
              </View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text variant="bodyMedium">RPC Endpoint:</Text>
                <Text variant="bodyMedium" style={{ 
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}>
                  api.devnet.solana.com
                </Text>
              </View>

              <Divider style={{ marginVertical: 12 }} />
              
              <Text variant="bodySmall" style={{ color: '#666', textAlign: 'center' }}>
                Friend Bets uses the Solana blockchain for secure, transparent betting markets.
              </Text>
            </Card.Content>
          </Card>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <View style={{ padding: 16 }}>
        {/* Header */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content style={{ alignItems: 'center' }}>
            <Avatar.Icon 
              size={64} 
              icon="wallet" 
              style={{ marginBottom: 12, backgroundColor: '#ff6b6b' }}
            />
            <Text variant="titleLarge" style={{ marginBottom: 8 }}>
              Connect Your Wallet
            </Text>
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: '#666' }}>
              Connect a Solana wallet to create markets, place bets, and claim winnings
            </Text>
          </Card.Content>
        </Card>

        {/* Available Wallets */}
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Available Wallets
            </Text>
            
            {wallets.length === 0 ? (
              <Text variant="bodyMedium" style={{ textAlign: 'center', color: '#666' }}>
                No wallets detected. Please install a Solana wallet extension.
              </Text>
            ) : (
              wallets.map((walletAdapter) => (
                <List.Item
                  key={walletAdapter.adapter.name}
                  title={walletAdapter.adapter.name}
                  description={walletAdapter.readyState === 'Installed' ? 'Ready to connect' : 'Not installed'}
                  left={(props) => (
                    <Avatar.Icon 
                      {...props} 
                      icon={getWalletIcon(walletAdapter.adapter.name)}
                      size={40}
                    />
                  )}
                  right={(props) => (
                    <Button
                      {...props}
                      mode={walletAdapter.readyState === 'Installed' ? 'contained' : 'outlined'}
                      disabled={walletAdapter.readyState !== 'Installed' || connecting}
                      loading={connecting && wallet?.adapter.name === walletAdapter.adapter.name}
                      onPress={() => handleWalletSelect(walletAdapter.adapter.name)}
                    >
                      {walletAdapter.readyState === 'Installed' ? 'Connect' : 'Install'}
                    </Button>
                  )}
                  style={{ paddingVertical: 8 }}
                />
              ))
            )}

            <Divider style={{ marginVertical: 16 }} />

            <TxButton
              mode="contained"
              onPress={handleConnect}
              loading={connecting}
              disabled={wallets.length === 0}
            >
              Open Wallet Selector
            </TxButton>
          </Card.Content>
        </Card>

        {/* Information */}
        <Card>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Why Connect a Wallet?
            </Text>
            
            <List.Item
              title="Create Markets"
              description="Start your own prediction markets with custom terms"
              left={(props) => <List.Icon {...props} icon="plus-circle" />}
            />
            
            <List.Item
              title="Place Bets"
              description="Bet on market outcomes with USDC tokens"
              left={(props) => <List.Icon {...props} icon="dice-6" />}
            />
            
            <List.Item
              title="Claim Winnings"
              description="Automatically claim your share of winning pools"
              left={(props) => <List.Icon {...props} icon="trophy" />}
            />
            
            <List.Item
              title="Secure & Trustless"
              description="All transactions secured by Solana blockchain"
              left={(props) => <List.Icon {...props} icon="shield-check" />}
            />

            <Surface style={{ 
              padding: 16, 
              borderRadius: 8,
              backgroundColor: '#fff3e0',
              marginTop: 16,
            }}>
              <Text variant="bodySmall" style={{ textAlign: 'center' }}>
                Friend Bets is in beta. Only bet amounts you can afford to lose.
                Currently running on Solana Devnet for testing.
              </Text>
            </Surface>
          </Card.Content>
        </Card>
      </View>
    </ScrollView>
  );
}