import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, ScrollView, RefreshControl } from 'react-native';
import { 
  Searchbar, 
  FAB, 
  Text,
  ActivityIndicator,
  Button,
  Chip,
} from 'react-native-paper';
import { useWallet } from '@solana/wallet-adapter-react';

import { MarketCard } from '@/components/MarketCard';
import { useMarkets } from '@/hooks/useMarkets';
import { MarketStatus } from '@/lib/grpc';

export default function HomePage() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MarketStatus | undefined>();

  const {
    data: markets,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useMarkets({
    titleFilter: searchQuery,
    statusFilter,
  });

  const handleCreateMarket = () => {
    if (!connected) {
      router.push('/wallet');
      return;
    }
    router.push('/create');
  };

  const handleMarketPress = (marketId: string) => {
    router.push(`/market/${marketId}`);
  };

  const filteredMarkets = markets?.filter(market => {
    if (!searchQuery) return true;
    return market.title.toLowerCase().includes(searchQuery.toLowerCase());
  }) || [];

  const renderContent = () => {
    if (isLoading && !markets) {
      return (
        <View style={{ 
          flex: 1, 
          justifyContent: 'center', 
          alignItems: 'center',
          padding: 20,
        }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 16 }}>Loading markets...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={{ 
          flex: 1, 
          justifyContent: 'center', 
          alignItems: 'center',
          padding: 20,
        }}>
          <Text variant="titleMedium" style={{ marginBottom: 16 }}>
            Error loading markets
          </Text>
          <Text variant="bodyMedium" style={{ 
            marginBottom: 16,
            textAlign: 'center',
          }}>
            {error instanceof Error ? error.message : 'Unknown error occurred'}
          </Text>
          <Button mode="contained" onPress={() => refetch()}>
            Try Again
          </Button>
        </View>
      );
    }

    if (!markets || markets.length === 0) {
      return (
        <View style={{ 
          flex: 1, 
          justifyContent: 'center', 
          alignItems: 'center',
          padding: 20,
        }}>
          <Text variant="titleMedium" style={{ marginBottom: 16 }}>
            No markets found
          </Text>
          <Text variant="bodyMedium" style={{ 
            marginBottom: 16,
            textAlign: 'center',
          }}>
            {searchQuery 
              ? `No markets match "${searchQuery}"`
              : 'Be the first to create a market!'
            }
          </Text>
          {connected && (
            <Button mode="contained" onPress={handleCreateMarket}>
              Create Market
            </Button>
          )}
        </View>
      );
    }

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        }
      >
        {filteredMarkets.map((market) => (
          <MarketCard
            key={market.id}
            market={market}
            onPress={() => handleMarketPress(market.id)}
            style={{ marginBottom: 12 }}
          />
        ))}
      </ScrollView>
    );
  };

  const statusFilters = [
    { label: 'All', value: undefined },
    { label: 'Open', value: MarketStatus.MARKET_STATUS_OPEN },
    { label: 'Pending', value: MarketStatus.MARKET_STATUS_PENDING_RESOLVE },
    { label: 'Resolved', value: MarketStatus.MARKET_STATUS_RESOLVED },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      {/* Header with search and filters */}
      <View style={{ 
        paddingHorizontal: 16, 
        paddingTop: 16,
        paddingBottom: 8,
        backgroundColor: 'white',
      }}>
        <Searchbar
          placeholder="Search markets..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={{ marginBottom: 12 }}
        />
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {statusFilters.map((filter) => (
            <Chip
              key={filter.label}
              mode={statusFilter === filter.value ? 'flat' : 'outlined'}
              selected={statusFilter === filter.value}
              onPress={() => setStatusFilter(filter.value)}
              style={{ marginRight: 8 }}
            >
              {filter.label}
            </Chip>
          ))}
        </ScrollView>
      </View>

      {/* Main content */}
      {renderContent()}

      {/* Floating action button */}
      <FAB
        icon="plus"
        label={connected ? "Create" : "Connect"}
        style={{
          position: 'absolute',
          margin: 16,
          right: 0,
          bottom: 0,
        }}
        onPress={handleCreateMarket}
      />

      {/* Connection status */}
      {!connected && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: '#ff6b6b',
          padding: 8,
        }}>
          <Text 
            variant="bodySmall" 
            style={{ 
              color: 'white', 
              textAlign: 'center',
            }}
          >
            Connect your wallet to create markets and place bets
          </Text>
        </View>
      )}
    </View>
  );
}