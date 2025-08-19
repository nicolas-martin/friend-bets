const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add support for React Native Web
config.resolver.alias = {
  ...config.resolver.alias,
  'react-native-svg': 'react-native-svg-web',
};

// Ensure web extensions are resolved
config.resolver.platforms = ['web', 'native', 'ios', 'android'];

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
  /\.expo\/.*/,
  /dist\/.*/,
  /web-build\/.*/,
  /target\/.*/,
  // Ignore nested node_modules that cause issues
  /node_modules\/.*\/node_modules\/.*/,
];

module.exports = config;