const nativeInfrastructurePaths = [
  "ci/scripts/bun-install.sh",
  "ci/scripts/macos-native-env.sh",
  "ci/scripts/macos/macos-native-preflight.ts",
  "ci/scripts/macos/macos-native-preflight.test.ts",
  "ci/scripts/macos/macos-native-selection.ts",
  "ci/scripts/toolchain.test.sh",
  ".mise.toml",
  ".xcode-version",
  "packages/homelab/mac-ci",
] as const;

export const nativeLanePaths: Readonly<Record<string, readonly string[]>> = {
  "hkctl-native": [...nativeInfrastructurePaths, "packages/hkctl"],
  "quotabar-macos": [
    ...nativeInfrastructurePaths,
    "packages/macos-ai-subscription-tracker",
  ],
  "tasknotes-native": [
    ...nativeInfrastructurePaths,
    "bun.lock",
    "bunfig.toml",
    "package.json",
    "patches",
    "packages/tasknotes-core",
    "packages/tasknotes-fixtures",
    "packages/tasknotes-macos",
    "packages/tasknotes-server",
    "packages/tasknotes-types",
  ],
};
