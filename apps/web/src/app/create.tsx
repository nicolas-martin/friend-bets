import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Card,
  Surface,
  HelperText,
  Switch,
  Divider,
} from 'react-native-paper';
import { useWallet } from '@solana/wallet-adapter-react';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTx } from '@/hooks/useTx';
import { TxButton } from '@/components/TxButton';
import { Toast } from '@/components/Toast';

export default function CreateMarketScreen() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { createMarket } = useTx();

  const [title, setTitle] = useState('');
  const [feeBps, setFeeBps] = useState('500'); // 5%
  const [endDate, setEndDate] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000)); // 24 hours from now
  const [resolveDeadline, setResolveDeadline] = useState(new Date(Date.now() + 48 * 60 * 60 * 1000)); // 48 hours from now
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showResolveDatePicker, setShowResolveDatePicker] = useState(false);
  const [autoResolve, setAutoResolve] = useState(false);

  const [errors, setErrors] = useState({
    title: '',
    feeBps: '',
    dates: '',
  });

  const validateForm = () => {
    const newErrors = { title: '', feeBps: '', dates: '' };
    let isValid = true;

    // Validate title
    if (!title.trim()) {
      newErrors.title = 'Title is required';
      isValid = false;
    } else if (title.trim().length < 5) {
      newErrors.title = 'Title must be at least 5 characters';
      isValid = false;
    }

    // Validate fee
    const feeNum = parseInt(feeBps);
    if (isNaN(feeNum) || feeNum < 0 || feeNum > 2000) {
      newErrors.feeBps = 'Fee must be between 0% and 20%';
      isValid = false;
    }

    // Validate dates
    if (endDate <= new Date()) {
      newErrors.dates = 'End date must be in the future';
      isValid = false;
    }

    if (resolveDeadline <= endDate) {
      newErrors.dates = 'Resolve deadline must be after end date';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleCreateMarket = async () => {
    if (!connected || !publicKey) {
      router.push('/wallet');
      return;
    }

    if (!validateForm()) {
      return;
    }

    try {
      const marketId = await createMarket({
        title: title.trim(),
        feeBps: parseInt(feeBps),
        endTs: Math.floor(endDate.getTime() / 1000),
        resolveDeadlineTs: Math.floor(resolveDeadline.getTime() / 1000),
      });

      router.replace(`/market/${marketId}`);
    } catch (error) {
      console.error('Failed to create market:', error);
      // Error will be handled by TxButton's error state
    }
  };

  if (!connected) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text variant="headlineSmall" style={{ marginBottom: 16, textAlign: 'center' }}>
          Connect Wallet Required
        </Text>
        <Text variant="bodyMedium" style={{ marginBottom: 24, textAlign: 'center' }}>
          You need to connect your wallet to create prediction markets.
        </Text>
        <Button mode="contained" onPress={() => router.push('/wallet')}>
          Connect Wallet
        </Button>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <View style={{ padding: 16 }}>
        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Market Details
            </Text>

            <TextInput
              label="Market Title"
              value={title}
              onChangeText={setTitle}
              mode="outlined"
              error={!!errors.title}
              style={{ marginBottom: 8 }}
              placeholder="What are you predicting?"
              maxLength={100}
            />
            <HelperText type="error" visible={!!errors.title}>
              {errors.title}
            </HelperText>

            <TextInput
              label="Creator Fee (%)"
              value={(parseInt(feeBps || '0') / 100).toString()}
              onChangeText={(text) => {
                const num = parseFloat(text) || 0;
                setFeeBps(Math.round(num * 100).toString());
              }}
              mode="outlined"
              error={!!errors.feeBps}
              keyboardType="decimal-pad"
              style={{ marginBottom: 8 }}
              right={<TextInput.Affix text="%" />}
            />
            <HelperText type="info" visible={!errors.feeBps}>
              Fee you'll earn from the total betting pool (0-20%)
            </HelperText>
            <HelperText type="error" visible={!!errors.feeBps}>
              {errors.feeBps}
            </HelperText>
          </Card.Content>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Timing
            </Text>

            <Surface style={{ padding: 16, marginBottom: 12, borderRadius: 8 }}>
              <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                Betting Ends
              </Text>
              <Button 
                mode="outlined" 
                onPress={() => setShowEndDatePicker(true)}
                style={{ marginBottom: 8 }}
              >
                {endDate.toLocaleDateString()} {endDate.toLocaleTimeString()}
              </Button>
              <HelperText type="info">
                When users can no longer place bets
              </HelperText>
            </Surface>

            <Surface style={{ padding: 16, marginBottom: 12, borderRadius: 8 }}>
              <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                Resolution Deadline
              </Text>
              <Button 
                mode="outlined" 
                onPress={() => setShowResolveDatePicker(true)}
                style={{ marginBottom: 8 }}
              >
                {resolveDeadline.toLocaleDateString()} {resolveDeadline.toLocaleTimeString()}
              </Button>
              <HelperText type="info">
                Deadline for you to resolve the market outcome
              </HelperText>
            </Surface>

            <HelperText type="error" visible={!!errors.dates}>
              {errors.dates}
            </HelperText>

            <Divider style={{ marginVertical: 16 }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">Auto-resolve if expired</Text>
                <HelperText type="info" style={{ marginTop: 0 }}>
                  Market gets cancelled if not resolved by deadline
                </HelperText>
              </View>
              <Switch
                value={autoResolve}
                onValueChange={setAutoResolve}
              />
            </View>
          </Card.Content>
        </Card>

        <Card style={{ marginBottom: 24 }}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>
              Summary
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Title: {title || 'Untitled Market'}
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Creator Fee: {(parseInt(feeBps || '0') / 100)}%
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Betting Period: {Math.round((endDate.getTime() - Date.now()) / (1000 * 60 * 60))} hours
            </Text>
            <Text variant="bodyMedium">
              Resolution Window: {Math.round((resolveDeadline.getTime() - endDate.getTime()) / (1000 * 60 * 60))} hours
            </Text>
          </Card.Content>
        </Card>

        <TxButton
          mode="contained"
          onPress={handleCreateMarket}
          disabled={!title.trim()}
          style={{ marginBottom: 32 }}
        >
          Create Market
        </TxButton>
      </View>

      {/* Date Pickers */}
      {showEndDatePicker && (
        <DateTimePicker
          value={endDate}
          mode="datetime"
          onChange={(event, selectedDate) => {
            setShowEndDatePicker(false);
            if (selectedDate) {
              setEndDate(selectedDate);
              // Automatically adjust resolve deadline if needed
              if (resolveDeadline <= selectedDate) {
                setResolveDeadline(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000));
              }
            }
          }}
        />
      )}

      {showResolveDatePicker && (
        <DateTimePicker
          value={resolveDeadline}
          mode="datetime"
          onChange={(event, selectedDate) => {
            setShowResolveDatePicker(false);
            if (selectedDate) {
              setResolveDeadline(selectedDate);
            }
          }}
        />
      )}
    </ScrollView>
  );
}