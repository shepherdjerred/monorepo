const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const fs = require("fs");
const path = require("path");

const monorepoRoot = path.resolve(__dirname, "../..");
const localNodeModules = path.resolve(__dirname, "node_modules");
const monorepoNodeModules = path.resolve(monorepoRoot, "node_modules");
const tasknotesTypesWorkspace = path.resolve(__dirname, "../tasknotes-types");

const watchFolders = [];
const nodeModulesPaths = [localNodeModules];
const extraNodeModules = {};

// tasknotes-types is a workspace dependency imported from source.
// Metro must watch it because it's outside this package root.
if (fs.existsSync(tasknotesTypesWorkspace)) {
  watchFolders.push(tasknotesTypesWorkspace);
  extraNodeModules["tasknotes-types"] = tasknotesTypesWorkspace;
}

// Bun may hoist into monorepo-level node_modules in some environments.
// Only include it when present so Release bundling in CI doesn't fail.
if (fs.existsSync(monorepoNodeModules)) {
  watchFolders.push(monorepoNodeModules);
  nodeModulesPaths.push(monorepoNodeModules);
}

const config = {
  projectRoot: __dirname,
  watchFolders,
  resolver: {
    nodeModulesPaths,
    extraNodeModules,
    unstable_enableSymlinks: true,
    // Force a single copy of React into the bundle. Under Bun's hoisted linker
    // (used for Release/Archive on Xcode Cloud) the monorepo root can hold a
    // different React (e.g. 19.2.7, pulled by another workspace package) than the
    // one React Native 0.85 requires (19.2.3). Metro would otherwise bundle both,
    // crashing at launch with "Cannot read property 'useEffect' of null" or
    // "Incompatible React versions: react vs react-native-renderer". Always
    // resolve react (and its subpaths) from THIS package's node_modules.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === "react" || moduleName.startsWith("react/")) {
        return {
          type: "sourceFile",
          filePath: require.resolve(moduleName, { paths: [localNodeModules] }),
        };
      }
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
