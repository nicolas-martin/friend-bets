import { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { TextInput, IconButton, Text } from 'react-native-paper';
import { ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { showSuccess, showError } from './Toast';

interface CopyFieldProps {
  label: string;
  value: string;
  style?: ViewStyle;
  multiline?: boolean;
  numberOfLines?: number;
}

export function CopyField({ 
  label, 
  value, 
  style, 
  multiline = false,
  numberOfLines = 1,
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      showSuccess('Copied!', `${label} copied to clipboard`);
      
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      showError('Copy failed', 'Could not copy to clipboard');
      console.error('Copy failed:', error);
    }
  };

  // Truncate long values for display
  const displayValue = value.length > 50 && !multiline 
    ? `${value.slice(0, 20)}...${value.slice(-20)}`
    : value;

  return (
    <View style={style}>
      <View style={{ position: 'relative' }}>
        <TextInput
          label={label}
          value={displayValue}
          mode="outlined"
          editable={false}
          multiline={multiline}
          numberOfLines={numberOfLines}
          style={{
            backgroundColor: '#f8f9fa',
          }}
          contentStyle={{
            fontFamily: 'monospace',
            fontSize: 12,
            color: '#333',
          }}
          right={
            <TextInput.Icon
              icon={copied ? 'check' : 'content-copy'}
              onPress={handleCopy}
              iconColor={copied ? '#4caf50' : '#666'}
            />
          }
        />
      </View>
      
      <TouchableOpacity
        onPress={handleCopy}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 40, // Leave space for the copy icon
          bottom: 0,
          backgroundColor: 'transparent',
        }}
        activeOpacity={0.7}
      />
      
      {value.length > 50 && !multiline && (
        <Text
          variant="bodySmall"
          style={{
            color: '#666',
            marginTop: 4,
            marginLeft: 16,
          }}
        >
          Tap to copy full value • {value.length} characters
        </Text>
      )}
    </View>
  );
}