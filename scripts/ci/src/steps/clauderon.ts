/**
 * Clauderon release step generators (Rust binary build + upload).
 */
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
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

export function clauderonReleaseGroup(): BuildkiteGroup {
  const buildSteps: BuildkiteStep[] = TARGETS.map((t) => ({
    label: `:rust: Build clauderon (${t.label})`,
    key: t.key,
    if: MAIN_ONLY,
    depends_on: "release",
    command: `dagger call rust-build --source . --target ${t.target}`,
    timeout_in_minutes: 20,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "2", memory: "4Gi", secrets: [] })],
  }));

  const uploadStep: BuildkiteStep = {
    label: ":rust: Upload clauderon binaries",
    key: "clauderon-upload",
    if: MAIN_ONLY,
    depends_on: TARGETS.map((t) => t.key),
    command: ".buildkite/scripts/clauderon-upload.sh",
    timeout_in_minutes: 10,
    retry: RETRY,
    plugins: [k8sPlugin({ cpu: "500m", memory: "512Mi", secrets: [] })],
  };

  return {
    group: ":rust: Clauderon Release",
    key: "clauderon-release",
    steps: [...buildSteps, uploadStep],
  };
}
