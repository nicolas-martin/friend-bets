import { MD3LightTheme, configureFonts } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';

// Custom font configuration (optional)
const fontConfig = {
  web: {
    regular: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '400' as const,
    },
    medium: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '500' as const,
    },
    light: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '300' as const,
    },
    thin: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '100' as const,
    },
  },
};

// Custom color palette
const customColors = {
  // Primary colors (Solana-inspired purple)
  primary: '#9945FF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E8D5FF',
  onPrimaryContainer: '#2E0051',
  
  // Secondary colors (Complementary green)
  secondary: '#14F195',
  onSecondary: '#000000',
  secondaryContainer: '#C7FFF0',
  onSecondaryContainer: '#002A20',
  
  // Tertiary colors (Orange for highlights)
  tertiary: '#FF6B35',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFDBD0',
  onTertiaryContainer: '#370C00',
  
  // Error colors
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  // Background colors
  background: '#FFFBFE',
  onBackground: '#1B1B1F',
  surface: '#FFFBFE',
  onSurface: '#1B1B1F',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  
  // Outline colors
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  
  // Surface tint and other colors
  surfaceTint: '#9945FF',
  inverseSurface: '#313033',
  inverseOnSurface: '#F3EFF4',
  inversePrimary: '#D0BCFF',
  shadow: '#000000',
  scrim: '#000000',
  
  // Custom app colors
  success: '#4CAF50',
  warning: '#FF9800',
  info: '#2196F3',
  
  // Market status colors
  marketOpen: '#4CAF50',
  marketPending: '#FF9800',
  marketResolved: '#2196F3',
  marketCancelled: '#F44336',
  
  // Betting colors
  sideA: '#2196F3',
  sideB: '#FF5722',
  
  // Background variations
  surfaceElevated: '#F7F2FA',
  surfaceDepressed: '#F0F0F0',
};

// Create the theme
export const theme: MD3Theme = {
  ...MD3LightTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: {
    ...MD3LightTheme.colors,
    ...customColors,
  },
};

// Dark theme (optional - can be implemented later)
export const darkTheme: MD3Theme = {
  ...theme,
  colors: {
    ...theme.colors,
    // Dark theme color overrides
    primary: '#D0BCFF',
    onPrimary: '#2E0051',
    background: '#101013',
    onBackground: '#E6E1E5',
    surface: '#101013',
    onSurface: '#E6E1E5',
    surfaceVariant: '#49454F',
    onSurfaceVariant: '#CAC4D0',
    outline: '#938F99',
    outlineVariant: '#49454F',
    inverseSurface: '#E6E1E5',
    inverseOnSurface: '#313033',
    surfaceElevated: '#1D1B20',
    surfaceDepressed: '#0A0A0A',
  },
};

// Theme utilities
export const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'open':
      return theme.colors.marketOpen;
    case 'pending':
    case 'pending_resolve':
      return theme.colors.marketPending;
    case 'resolved':
      return theme.colors.marketResolved;
    case 'cancelled':
      return theme.colors.marketCancelled;
    default:
      return theme.colors.outline;
  }
};

export const getSideColor = (side: 'A' | 'B'): string => {
  return side === 'A' ? theme.colors.sideA : theme.colors.sideB;
};

// Spacing system
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Border radius system
export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Elevation system
export const elevation = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 8,
  xl: 16,
};

// Typography helpers
export const typography = {
  // Display styles
  displayLarge: {
    fontSize: 57,
    lineHeight: 64,
    fontWeight: '400' as const,
  },
  displayMedium: {
    fontSize: 45,
    lineHeight: 52,
    fontWeight: '400' as const,
  },
  displaySmall: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '400' as const,
  },
  
  // Headline styles
  headlineLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '400' as const,
  },
  headlineMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '400' as const,
  },
  headlineSmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '400' as const,
  },
  
  // Title styles
  titleLarge: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '400' as const,
  },
  titleMedium: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
  },
  
  // Label styles
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  
  // Body styles
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
  },
};

export default theme;