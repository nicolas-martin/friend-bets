import { View } from 'react-native';
import { Text, Surface, TouchableRipple } from 'react-native-paper';
import { ViewStyle } from 'react-native';

import { OddsPill } from './OddsPill';

interface SideSelectorProps {
  selectedSide: 'A' | 'B';
  onSideChange: (side: 'A' | 'B') => void;
  sideAOdds: number;
  sideBOdds: number;
  style?: ViewStyle;
}

export function SideSelector({
  selectedSide,
  onSideChange,
  sideAOdds,
  sideBOdds,
  style,
}: SideSelectorProps) {
  const SideOption = ({ 
    side, 
    odds, 
    color 
  }: { 
    side: 'A' | 'B'; 
    odds: number; 
    color: string;
  }) => {
    const isSelected = selectedSide === side;
    
    return (
      <TouchableRipple
        onPress={() => onSideChange(side)}
        style={{ flex: 1, borderRadius: 12 }}
      >
        <Surface
          style={{
            padding: 16,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: isSelected ? color : '#e0e0e0',
            backgroundColor: isSelected ? `${color}15` : 'white',
            alignItems: 'center',
          }}
          elevation={isSelected ? 2 : 0}
        >
          <View style={{ alignItems: 'center' }}>
            <Text
              variant="titleLarge"
              style={{
                color: isSelected ? color : '#666',
                fontWeight: 'bold',
                marginBottom: 8,
              }}
            >
              Side {side}
            </Text>
            
            <OddsPill odds={odds} />
            
            <Text
              variant="bodySmall"
              style={{
                color: '#666',
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              {isSelected ? 'Selected' : 'Tap to select'}
            </Text>
          </View>
        </Surface>
      </TouchableRipple>
    );
  };

  return (
    <View style={style}>
      <Text
        variant="titleMedium"
        style={{
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        Choose your side
      </Text>
      
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
        }}
      >
        <SideOption
          side="A"
          odds={sideAOdds}
          color="#2196f3"
        />
        
        <SideOption
          side="B"
          odds={sideBOdds}
          color="#ff5722"
        />
      </View>
      
      <Text
        variant="bodySmall"
        style={{
          marginTop: 12,
          textAlign: 'center',
          color: '#666',
        }}
      >
        Higher odds mean lower chance but bigger payout
      </Text>
    </View>
  );
}