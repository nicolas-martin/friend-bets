import { useState, useEffect } from 'react';
import { View } from 'react-native';
import { Text, Chip } from 'react-native-paper';
import { ViewStyle } from 'react-native';

interface CountdownProps {
  endTime: number; // Unix timestamp in milliseconds
  label?: string;
  style?: ViewStyle;
  compact?: boolean;
}

export function Countdown({ 
  endTime, 
  label = 'Time remaining',
  style, 
  compact = false 
}: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const diff = endTime - now;
      
      if (diff <= 0) {
        setExpired(true);
        setTimeLeft('Expired');
        return;
      }
      
      setExpired(false);
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [endTime]);

  if (compact) {
    return (
      <Chip
        icon={expired ? 'clock-alert' : 'clock'}
        style={[
          {
            backgroundColor: expired ? '#ffebee' : '#e8f5e8',
          },
          style,
        ]}
        textStyle={{
          color: expired ? '#d32f2f' : '#2e7d32',
          fontSize: 11,
          fontWeight: 'bold',
        }}
        compact
      >
        {timeLeft}
      </Chip>
    );
  }

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      {label && (
        <Text
          variant="bodySmall"
          style={{
            color: '#666',
            marginBottom: 4,
          }}
        >
          {label}
        </Text>
      )}
      
      <Text
        variant="titleMedium"
        style={{
          color: expired ? '#d32f2f' : '#2e7d32',
          fontWeight: 'bold',
          fontFamily: 'monospace',
        }}
      >
        {timeLeft}
      </Text>
      
      {expired && (
        <Text
          variant="bodySmall"
          style={{
            color: '#d32f2f',
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          This deadline has passed
        </Text>
      )}
    </View>
  );
}