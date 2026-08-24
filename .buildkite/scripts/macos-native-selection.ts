const nativeInfrastructurePaths = [
  ".buildkite/scripts/bun-install.sh",
  ".buildkite/scripts/macos-native-dispatch-watch.ts",
  ".buildkite/scripts/macos-native-dispatch-watch.test.ts",
  ".buildkite/scripts/macos-native-env.sh",
  ".buildkite/scripts/macos-native-preflight.ts",
  ".buildkite/scripts/macos-native-preflight.test.ts",
  ".buildkite/scripts/macos-native-selection.ts",
  ".buildkite/scripts/toolchain.test.sh",
  ".buildkite/scripts/validate-pipeline.ts",
  ".buildkite/scripts/validate-pipeline-lib.ts",
  ".buildkite/scripts/validate-pipeline-lib.test.ts",
  ".mise.toml",
  ".xcode-version",
  "packages/homelab/mac-ci",
] as const;

export const nativeLanePaths: Readonly<Record<string, readonly string[]>> = {
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
