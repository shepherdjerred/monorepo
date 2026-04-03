/**
 * Clauderon release step generators (Rust binary build + upload).
 */
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

interface BuildTarget {
  target: string;
  filename: string;
  label: string;
  key: string;
}

const TARGETS: BuildTarget[] = [
  {
    target: "x86_64-unknown-linux-gnu",
    filename: "clauderon-linux-x86_64",
    label: "x86_64",
    key: "clauderon-build-x86-64",
  },
  {
    target: "aarch64-unknown-linux-gnu",
    filename: "clauderon-linux-arm64",
    label: "arm64",
    key: "clauderon-build-arm64",
  },
];

export function clauderonReleaseGroup(pkgKey?: string): BuildkiteGroup {
  const dependsOn = pkgKey ? ["release", pkgKey] : ["release"];
  const buildSteps: BuildkiteStep[] = TARGETS.map((t) => ({
    label: `:rust: Build clauderon (${t.label})`,
    key: t.key,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `dagger call rust-build --pkg-dir ./packages/clauderon --target ${t.target}`,
    timeout_in_minutes: 20,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi", secrets: [] })],
  }));

  const uploadStep: BuildkiteStep = {
    label: ":rust: Upload clauderon binaries",
    key: "clauderon-upload",
    if: MAIN_ONLY,
    depends_on: TARGETS.map((t) => t.key),
    command: `dagger call clauderon-build-and-upload --pkg-dir ./packages/clauderon --version "$(buildkite-agent meta-data get clauderon_version)" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeout_in_minutes: 10,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };

  return {
    group: ":rust: Clauderon Release",
    key: "clauderon-release",
    steps: [...buildSteps, uploadStep],
  };
}
