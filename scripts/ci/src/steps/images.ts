/**
 * Image build and push step generators.
 *
 * Build steps (build-phase) warm the Dagger cache and run smoke tests.
 * Push steps (release-phase) publish to GHCR, reusing the cached build.
 */
import type { ImageTarget } from "../catalog.ts";
import { IMAGE_PUSH_TARGETS, INFRA_PUSH_TARGETS } from "../catalog.ts";
import { safeKey, RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function depFlags(pkg: string): string {
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  return deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
}

// ---------------------------------------------------------------------------
// Build steps (build phase — depends on quality-gate)
// ---------------------------------------------------------------------------

function imageBuildStep(
  img: ImageTarget,
  dependsOn: string | string[] = "quality-gate",
): BuildkiteStep {
  const pkg = img.package ?? img.name;
  const flags = depFlags(pkg);
  const cmd = [
    `dagger call build-image --pkg-dir ./packages/${pkg} --pkg ${img.name}`,
    flags,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: `:docker: Build ${img.name}`,
    key: `build-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
      }),
    ],
  };
}

/**
 * Per-package smoke test Dagger function names (kebab-case, as called via CLI).
 * Each maps to a dedicated @func() in index.ts that runs package-specific
 * startup verification with dummy env vars and log pattern checking.
 */
const SMOKE_TEST_FUNCTIONS: Record<string, string> = {
  birmel: "smoke-test-birmel",
  "scout-for-lol": "smoke-test-scout-for-lol",
  "starlight-karma-bot": "smoke-test-starlight-karma-bot",
  "tasknotes-server": "smoke-test-tasknotes-server",
};

function smokeTestStep(
  img: ImageTarget,
  dependsOn: string | string[],
): BuildkiteStep | null {
  const daggerFn = SMOKE_TEST_FUNCTIONS[img.name];
  if (!daggerFn) return null;
  const pkg = img.package ?? img.name;
  const flags = depFlags(pkg);
  const cmd = [
    `dagger call ${daggerFn}`,
    `--pkg-dir ./packages/${pkg} --pkg ${img.name}`,
    flags,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: `:heartbeat: Smoke ${img.name}`,
    key: `smoke-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 5,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "100m",
        memory: "256Mi",
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Push steps (release phase — depends on build/smoke completing)
// ---------------------------------------------------------------------------

function imagePushStep(
  img: ImageTarget,
  dependsOn: string | string[],
): BuildkiteStep {
  const pkg = img.package ?? img.name;
  const flags = depFlags(pkg);
  const cmd = [
    `DIGEST=$(dagger call push-image --pkg-dir ./packages/${pkg} --pkg ${img.name}`,
    flags,
    `--tags ghcr.io/${img.versionKey}:$BUILDKITE_BUILD_NUMBER`,
    `--tags ghcr.io/${img.versionKey}:latest`,
    `--registry-username shepherdjerred`,
    `--registry-password env:GH_TOKEN)`,
    `&& if [ -n "$DIGEST" ]; then buildkite-agent meta-data set "digest:${img.versionKey}" "$DIGEST"; else echo "WARN: empty digest for ${img.name}"; fi`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: `:docker: Push ${img.name}`,
    key: `push-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Build-phase groups (build + smoke tests)
// ---------------------------------------------------------------------------

export function buildImagesWithSmokeGroup(
  images: readonly ImageTarget[] = IMAGE_PUSH_TARGETS,
  pkgKeyMap?: Map<string, string>,
): BuildkiteGroup {
  const steps: BuildkiteStep[] = [];
  for (const img of images) {
    const pkg = img.package ?? img.name;
    const pkgKey = pkgKeyMap?.get(pkg);
    const buildDeps: string[] = pkgKey
      ? ["quality-gate", pkgKey]
      : ["quality-gate"];

    const build = imageBuildStep(img, buildDeps);
    steps.push(build);

    const smoke = smokeTestStep(img, `build-${safeKey(img.name)}`);
    if (smoke) {
      steps.push(smoke);
    }
  }
  return {
    group: ":package: Build Images",
    key: "build-images",
    steps,
  };
}

export function homelabImagesBuildGroup(
  homelabPkgKey?: string,
): BuildkiteGroup {
  const buildDeps = homelabPkgKey
    ? ["quality-gate", homelabPkgKey]
    : ["quality-gate"];
  return {
    group: ":kubernetes: Build Homelab Images",
    key: "build-homelab-images",
    steps: INFRA_PUSH_TARGETS.map((img) => imageBuildStep(img, buildDeps)),
  };
}

// ---------------------------------------------------------------------------
// Push-phase groups (push only, depends on build/smoke completing)
// ---------------------------------------------------------------------------

export function pushImagesGroup(
  images: readonly ImageTarget[] = IMAGE_PUSH_TARGETS,
): BuildkiteGroup {
  const steps: BuildkiteStep[] = [];
  for (const img of images) {
    const smoke = SMOKE_TEST_FUNCTIONS[img.name];
    const pushDep = smoke
      ? `smoke-${safeKey(img.name)}`
      : `build-${safeKey(img.name)}`;
    steps.push(imagePushStep(img, pushDep));
  }
  return {
    group: ":package: Push Images",
    key: "push-images",
    steps,
  };
}

export function homelabImagesPushGroup(): BuildkiteGroup {
  return {
    group: ":kubernetes: Push Homelab Images",
    key: "push-homelab-images",
    steps: INFRA_PUSH_TARGETS.map((img) =>
      imagePushStep(img, `build-${safeKey(img.name)}`),
    ),
  };
}

// ---------------------------------------------------------------------------
// Key helpers for downstream dependency wiring
// ---------------------------------------------------------------------------

export function allPushKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `push-${safeKey(img.name)}`);
}

export function allBuildKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `build-${safeKey(img.name)}`);
}
