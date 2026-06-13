const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const fs = require("fs");
const path = require("path");
const rnwPath = fs.realpathSync(
  path.resolve(require.resolve("react-native-windows/package.json"), ".."),
);

// Resolve the symlinked shared types directory
const sharedTypesPath = path.resolve(__dirname, "../web/shared/src");

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */

// Path to react-macos (React 19.1.4 for macOS compatibility)
const reactMacosPath = path.resolve(__dirname, "node_modules/react-macos");
// Path to react-native-macos (for macOS builds)
const rnMacosPath = path.resolve(__dirname, "node_modules/react-native-macos");

const config = {
  watchFolders: [sharedTypesPath],
  resolver: {
    blockList: [
      // This stops "npx @react-native-community/cli run-windows" from causing the metro server to crash if its already running
      new RegExp(`${path.resolve(__dirname, "windows").replace(/[/\\]/g, "/")}.*`),
      // This prevents "npx @react-native-community/cli run-windows" from hitting: EBUSY: resource busy or locked, open msbuild.ProjectImports.zip or other files produced by msbuild
      new RegExp(`${rnwPath}/build/.*`),
      new RegExp(`${rnwPath}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
    // For macOS builds, use compatible versions of react and react-native
    resolveRequest: (context, moduleName, platform) => {
      if (platform === "macos") {
        // Use React 19.1.4 for macOS (react-native-macos requires this version)
        if (moduleName === "react") {
          return {
            filePath: path.join(reactMacosPath, "index.js"),
            type: "sourceFile",
          };
        }
        // Redirect all react-native imports to react-native-macos
        if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
          const subPath = moduleName.replace("react-native", "");
          const targetPath = path.join(rnMacosPath, subPath || "index.js");
          // Check if the file exists, if not try with index.js
          if (fs.existsSync(targetPath)) {
            return {
              filePath: targetPath,
              type: "sourceFile",
            };
          }
          if (fs.existsSync(targetPath + ".js")) {
            return {
              filePath: targetPath + ".js",
              type: "sourceFile",
            };
          }
          if (fs.existsSync(path.join(targetPath, "index.js"))) {
            return {
              filePath: path.join(targetPath, "index.js"),
              type: "sourceFile",
            };
          }
          // Fall back to the default resolution but with react-native-macos path
          return context.resolveRequest(
            context,
            moduleName.replace("react-native", "react-native-macos"),
            platform,
          );
        }
      }
      // Fall back to default resolution
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

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
