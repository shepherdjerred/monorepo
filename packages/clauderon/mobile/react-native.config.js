module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
      automaticPodsInstallation: false,
    },
    android: {
      sourceDir: './android',
    },
    // Note: macos and windows are temporarily disabled to avoid codegen conflicts
    // with react-native. Re-enable when building for those platforms.
    // macos: {
    //   sourceDir: './macos',
    //   automaticPodsInstallation: false,
    // },
    // windows: {
    //   sourceDir: './windows',
    //   solutionFile: 'ClauderonMobile.sln',
    //   project: {
    //     projectFile: 'ClauderonMobile/ClauderonMobile.vcxproj',
    //   },
    // },
  },
  // Exclude react-native-macos and react-native-windows from autolinking
  // to avoid module conflicts during iOS/Android builds
  dependencies: {
    'react-native-macos': {
      platforms: {
        ios: null,
        android: null,
      },
    },
    'react-native-windows': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
