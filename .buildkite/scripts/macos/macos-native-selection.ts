const nativeInfrastructurePaths = [
  ".buildkite/scripts/bun-install.sh",
  ".buildkite/scripts/macos/macos-native-dispatch-watch.ts",
  ".buildkite/scripts/macos/macos-native-dispatch-watch.test.ts",
  ".buildkite/scripts/macos-native-env.sh",
  ".buildkite/scripts/macos/macos-native-preflight.ts",
  ".buildkite/scripts/macos/macos-native-preflight.test.ts",
  ".buildkite/scripts/macos/macos-native-selection.ts",
  ".buildkite/scripts/toolchain.test.sh",
  ".buildkite/scripts/validation/validate-pipeline.ts",
  ".buildkite/scripts/validation/validate-pipeline-lib.ts",
  ".buildkite/scripts/validation/validate-pipeline-lib.test.ts",
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
    "packages/tasknotes-macos",
    "packages/tasknotes-server",
    "packages/tasknotes-types",
  ],
};
