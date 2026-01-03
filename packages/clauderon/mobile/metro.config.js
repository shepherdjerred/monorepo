const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const config = {
  resolver: {
    // Support symlinks for type sharing
    resolveRequest: (context, moduleName, platform) => {
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  watchFolders: [
    // Watch the web/shared/src/generated directory for type changes
    path.resolve(__dirname, '../web/shared/src/generated'),
  ],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
