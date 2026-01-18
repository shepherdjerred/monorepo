module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
      automaticPodsInstallation: false,
    },
    android: {
      sourceDir: './android',
    },
    macos: {
      sourceDir: './macos',
      automaticPodsInstallation: false,
    },
    windows: {
      sourceDir: './windows',
      solutionFile: 'ClauderonMobile.sln',
      project: {
        projectFile: 'ClauderonMobile/ClauderonMobile.vcxproj',
      },
    },
  },
};
