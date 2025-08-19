import { useState } from 'react';
import { View } from 'react-native';
import { TextInput, Text, Chip, Surface } from 'react-native-paper';
import { ViewStyle } from 'react-native';

interface TokenAmountInputProps {
  value: string;
  onValueChange: (value: string) => void;
  symbol?: string;
  disabled?: boolean;
  error?: string;
  style?: ViewStyle;
  placeholder?: string;
}

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

export function TokenAmountInput({
  value,
  onValueChange,
  symbol = 'USDC',
  disabled = false,
  error,
  style,
  placeholder = 'Enter amount',
}: TokenAmountInputProps) {
  const [focused, setFocused] = useState(false);

  const handleQuickAmount = (amount: number) => {
    onValueChange(amount.toString());
  };

  const formatValue = (input: string) => {
    // Remove non-numeric characters except decimal point
    const cleaned = input.replace(/[^0-9.]/g, '');
    
    // Prevent multiple decimal points
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      return parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limit decimal places to 6 (for USDC precision)
    if (parts[1] && parts[1].length > 6) {
      return parts[0] + '.' + parts[1].slice(0, 6);
    }
    
    return cleaned;
  };

  const handleChangeText = (text: string) => {
    const formatted = formatValue(text);
    onValueChange(formatted);
  };

  return (
    <View style={style}>
      <TextInput
        label={`Amount (${symbol})`}
        value={value}
        onChangeText={handleChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        mode="outlined"
        keyboardType="decimal-pad"
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        right={
          <TextInput.Affix 
            text={symbol}
            textStyle={{ 
              fontWeight: 'bold',
              color: focused ? '#6200ee' : '#666',
            }}
          />
        }
        style={{
          marginBottom: error ? 4 : 8,
        }}
      />
      
      {error && (
        <Text
          variant="bodySmall"
          style={{
            color: '#d32f2f',
            marginBottom: 8,
            marginLeft: 16,
          }}
        >
          {error}
        </Text>
      )}

      {/* Quick Amount Buttons */}
      <Surface
        style={{
          padding: 12,
          borderRadius: 8,
          backgroundColor: '#f8f9fa',
        }}
      >
        <Text
          variant="bodySmall"
          style={{
            marginBottom: 8,
            color: '#666',
            textAlign: 'center',
          }}
        >
          Quick amounts
        </Text>
        
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-around',
            gap: 8,
          }}
        >
          {QUICK_AMOUNTS.map((amount) => (
            <Chip
              key={amount}
              mode={parseInt(value) === amount ? 'flat' : 'outlined'}
              selected={parseInt(value) === amount}
              onPress={() => handleQuickAmount(amount)}
              disabled={disabled}
              style={{
                minWidth: 60,
              }}
              textStyle={{
                fontSize: 12,
              }}
            >
              {amount}
            </Chip>
          ))}
        </View>
        
        <View style={{ marginTop: 8, alignItems: 'center' }}>
          <Chip
            mode="outlined"
            onPress={() => onValueChange('')}
            disabled={disabled || !value}
            icon="close"
            textStyle={{ fontSize: 11 }}
          >
            Clear
          </Chip>
        </View>
      </Surface>
    </View>
  );
}