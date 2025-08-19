import { Chip } from 'react-native-paper';
import { ViewStyle } from 'react-native';

import { MarketStatus } from '@/lib/grpc';

interface StatusChipProps {
  status: MarketStatus;
  style?: ViewStyle;
}

export function StatusChip({ status, style }: StatusChipProps) {
  const getStatusConfig = (status: MarketStatus) => {
    switch (status) {
      case MarketStatus.MARKET_STATUS_OPEN:
        return {
          text: 'Open',
          backgroundColor: '#4caf50',
          textColor: 'white',
          icon: 'circle' as const,
        };
      case MarketStatus.MARKET_STATUS_PENDING_RESOLVE:
        return {
          text: 'Pending',
          backgroundColor: '#ff9800',
          textColor: 'white', 
          icon: 'clock' as const,
        };
      case MarketStatus.MARKET_STATUS_RESOLVED:
        return {
          text: 'Resolved',
          backgroundColor: '#2196f3',
          textColor: 'white',
          icon: 'check-circle' as const,
        };
      case MarketStatus.MARKET_STATUS_CANCELLED:
        return {
          text: 'Cancelled',
          backgroundColor: '#f44336',
          textColor: 'white',
          icon: 'close-circle' as const,
        };
      default:
        return {
          text: 'Unknown',
          backgroundColor: '#9e9e9e',
          textColor: 'white',
          icon: 'help-circle' as const,
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <Chip
      icon={config.icon}
      style={[
        {
          backgroundColor: config.backgroundColor,
        },
        style,
      ]}
      textStyle={{ 
        color: config.textColor,
        fontSize: 12,
        fontWeight: 'bold',
      }}
      compact
    >
      {config.text}
    </Chip>
  );
}