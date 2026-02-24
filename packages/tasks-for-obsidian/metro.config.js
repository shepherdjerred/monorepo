const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");

// Bun hoists packages to the monorepo root via symlinks.
// Metro must follow symlinks and watch the monorepo root node_modules.
const monorepoRoot = path.resolve(__dirname, "../..");

const config = {
  projectRoot: __dirname,
  watchFolders: [path.resolve(monorepoRoot, "node_modules")],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(monorepoRoot, "node_modules"),
    ],
    unstable_enableSymlinks: true,
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
