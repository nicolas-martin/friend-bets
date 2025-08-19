import { Text, Surface } from 'react-native-paper';
import { ViewStyle } from 'react-native';

interface OddsPillProps {
  odds: number;
  style?: ViewStyle;
  compact?: boolean;
}

export function OddsPill({ odds, style, compact = false }: OddsPillProps) {
  const getOddsColor = (odds: number) => {
    if (odds >= 3) return '#4caf50'; // High odds, green
    if (odds >= 2) return '#ff9800'; // Medium odds, orange  
    return '#f44336'; // Low odds, red
  };

  const formatOdds = (odds: number) => {
    if (odds === Infinity || isNaN(odds)) return '∞';
    if (odds < 1) return '0x';
    return `${odds.toFixed(1)}x`;
  };

  return (
    <Surface
      style={[
        {
          backgroundColor: getOddsColor(odds),
          borderRadius: compact ? 8 : 12,
          paddingHorizontal: compact ? 6 : 8,
          paddingVertical: compact ? 2 : 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
      elevation={0}
    >
      <Text
        variant={compact ? "bodySmall" : "bodyMedium"}
        style={{
          color: 'white',
          fontWeight: 'bold',
          fontSize: compact ? 10 : 12,
        }}
      >
        {formatOdds(odds)}
      </Text>
    </Surface>
  );
}