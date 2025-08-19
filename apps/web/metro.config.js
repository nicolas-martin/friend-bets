const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for React Native Web
config.resolver.alias = {
  ...config.resolver.alias,
  'react-native-svg': 'react-native-svg-web',
};

// Ensure web extensions are resolved
config.resolver.platforms = ['web', 'native', 'ios', 'android'];

module.exports = config;