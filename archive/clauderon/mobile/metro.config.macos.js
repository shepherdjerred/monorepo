/**
 * Metro configuration for macOS builds
 * Uses react-native-macos and compatible React version
 */
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");
const fs = require("fs");

// Paths to macOS-compatible packages
const projectRoot = __dirname;
const reactMacosPath = path.resolve(projectRoot, "node_modules/react-macos");
const rnMacosPath = path.resolve(projectRoot, "node_modules/react-native-macos");
const sharedTypesPath = path.resolve(projectRoot, "../web/shared/src");

const defaultConfig = getDefaultConfig(projectRoot);

const config = {
  watchFolders: [sharedTypesPath],
  resolver: {
    // Custom resolver to redirect react and react-native to macOS-compatible versions
    resolveRequest: (context, moduleName, platform) => {
      // Redirect 'react' to 'react-macos' (React 19.1.4)
      if (moduleName === "react") {
        return context.resolveRequest(context, "react-macos", platform);
      }

      // Redirect 'react-native' and subpaths to 'react-native-macos'
      if (moduleName === "react-native") {
        return context.resolveRequest(context, "react-native-macos", platform);
      }
      if (moduleName.startsWith("react-native/")) {
        const newModuleName = moduleName.replace("react-native/", "react-native-macos/");
        return context.resolveRequest(context, newModuleName, platform);
      }

      // Default resolution
      return context.resolveRequest(context, moduleName, platform);
    },
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

module.exports = mergeConfig(defaultConfig, config);
