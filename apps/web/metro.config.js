const { getDefaultConfig } = require('@expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add transformer to handle import.meta
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('./metro.transformer.js'),
};

// Add support for React Native Web with comprehensive aliasing
config.resolver.alias = {
  ...config.resolver.alias,
  'react-native-svg': 'react-native-svg-web',
  'react-native$': 'react-native-web',
  // Fix specific react-native-web dist resolution issues
  'react-native-web/dist/index': 'react-native-web/dist/index.js',
};

// Ensure web extensions are resolved first
config.resolver.platforms = ['web', 'native', 'ios', 'android'];

// Set main fields for package resolution
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// Add source extensions to help with resolution
config.resolver.sourceExts = [...config.resolver.sourceExts];

// Remove custom resolver to avoid SHA-1 issues

// Add extensions for better resolution
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'web.ts',
  'web.tsx', 
  'web.js',
  'web.jsx'
];

// Limit what files are watched to reduce EMFILE errors
const projectRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');

config.watchFolders = [
  projectRoot,
  // Only watch the IDL files we need from contracts
  path.resolve(workspaceRoot, 'packages/contracts/idl'),
];

// Ignore patterns to reduce file watching load
config.resolver.blockList = [
  // Ignore backend and other apps
  /apps\/backend\/.*/,
  // Ignore package node_modules except our own
  /packages\/.*\/node_modules\/.*/,
  // Ignore git and build directories
  /\.git\/.*/,
  /web-build\/.*/,
  /target\/.*/,
  // Ignore nested node_modules that cause issues
  /node_modules\/.*\/node_modules\/.*/,
];

module.exports = config;