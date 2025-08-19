import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
	PhantomWalletAdapter,
	SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { useMemo } from 'react';

import { theme } from '@/styles/theme';
import { Toast } from '@/components/Toast';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Create a client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30 * 1000, // 30 seconds
			retry: 2,
		},
		mutations: {
			retry: 1,
		},
	},
});

export default function RootLayout() {
	const [loaded, error] = useFonts({
		// Add any custom fonts here if needed
	});

	// Expo Router uses Error Boundaries to catch errors in the navigation tree.
	useEffect(() => {
		if (error) throw error;
	}, [error]);

	useEffect(() => {
		if (loaded) {
			SplashScreen.hideAsync();
		}
	}, [loaded]);

	if (!loaded) {
		return null;
	}

	return <RootLayoutNav />;
}

function RootLayoutNav() {
	// Configure Solana wallet adapters
	const networkType = (process.env.EXPO_PUBLIC_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';
	const network = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(networkType);

	const wallets = useMemo(
		() => [
			new PhantomWalletAdapter(),
			new SolflareWalletAdapter(),
		],
		[]
	);

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<ConnectionProvider endpoint={network}>
				<WalletProvider wallets={wallets} autoConnect>
					<SafeAreaProvider>
						<QueryClientProvider client={queryClient}>
							<PaperProvider theme={theme}>
								<Stack
									screenOptions={{
										headerStyle: {
											backgroundColor: theme.colors.surface,
										},
										headerTintColor: theme.colors.onSurface,
										headerTitleStyle: {
											fontWeight: '600',
										},
									}}
								>
									<Stack.Screen
										name="index"
										options={{
											title: 'Friend Bets',
											headerRight: () => null, // Add wallet connection button later
										}}
									/>
									<Stack.Screen
										name="create"
										options={{
											title: 'Create Market',
											presentation: 'modal',
										}}
									/>
									<Stack.Screen
										name="market/[market]"
										options={{
											title: 'Market Details',
										}}
									/>
									<Stack.Screen
										name="resolve/[market]"
										options={{
											title: 'Resolve Market',
											presentation: 'modal',
										}}
									/>
									<Stack.Screen
										name="wallet"
										options={{
											title: 'Wallet',
											presentation: 'modal',
										}}
									/>
								</Stack>
								<Toast />
							</PaperProvider>
						</QueryClientProvider>
					</SafeAreaProvider>
				</WalletProvider>
			</ConnectionProvider>
		</GestureHandlerRootView>
	);
}
