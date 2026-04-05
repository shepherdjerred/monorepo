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
  const buildFn = img.buildFn ?? "build-image";

  // Custom build functions that need no local source (built from upstream images only)
  const NO_SOURCE_BUILDS = new Set([
    "build-dns-audit-image",
    "build-caddy-s-3-proxy-image",
    "build-obsidian-headless-image",
  ]);

  const flags = depFlags(pkg);
  let cmd: string;
  if (img.buildFn && NO_SOURCE_BUILDS.has(buildFn)) {
    cmd = `dagger call ${buildFn}`;
  } else if (img.buildFn) {
    // Custom build functions take --pkg-dir + dep flags (no --pkg)
    cmd = [`dagger call ${buildFn} --pkg-dir ./packages/${pkg}`, flags]
      .filter(Boolean)
      .join(" ");
  } else {
    // Default build-image takes --pkg-dir, --pkg, and dep flags
    cmd = [
      `dagger call ${buildFn} --pkg-dir ./packages/${pkg} --pkg ${img.name}`,
      flags,
    ]
      .filter(Boolean)
      .join(" ");
  }

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
  homelab: "smoke-test-homelab",
  "dependency-summary": "smoke-test-deps-summary",
  "dns-audit": "smoke-test-dns-audit",
  "caddy-s3proxy": "smoke-test-caddy-s-3-proxy",
  "obsidian-headless": "smoke-test-obsidian-headless",
  "discord-plays-pokemon": "smoke-test-discord-plays-pokemon",
  "better-skill-capped-fetcher": "smoke-test-better-skill-capped-fetcher",
};

// Smoke test functions that take no arguments (standalone images)
const SMOKE_NO_ARGS = new Set([
  "smoke-test-dns-audit",
  "smoke-test-caddy-s-3-proxy",
  "smoke-test-obsidian-headless",
]);

// Smoke test functions that take --pkg-dir + dep flags but no --pkg (custom infra images)
const SMOKE_CUSTOM_INFRA = new Set([
  "smoke-test-homelab",
  "smoke-test-deps-summary",
]);

function smokeTestStep(
  img: ImageTarget,
  dependsOn: string | string[],
): BuildkiteStep | null {
  const daggerFn = SMOKE_TEST_FUNCTIONS[img.name];
  if (!daggerFn) return null;
  const pkg = img.package ?? img.name;
  const flags = depFlags(pkg);

  let cmd: string;
  if (SMOKE_NO_ARGS.has(daggerFn)) {
    cmd = `dagger call ${daggerFn}`;
  } else if (SMOKE_CUSTOM_INFRA.has(daggerFn)) {
    cmd = [`dagger call ${daggerFn} --pkg-dir ./packages/${pkg}`, flags]
      .filter(Boolean)
      .join(" ");
  } else {
    cmd = [
      `dagger call ${daggerFn}`,
      `--pkg-dir ./packages/${pkg} --pkg ${img.name}`,
      flags,
      `--tsconfig ./tsconfig.base.json`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    label: `:heartbeat: Smoke ${img.name}`,
    key: `smoke-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 10,
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
  const pushFn = img.pushFn ?? "push-image";

  const tagFlags = [
    `--tags ghcr.io/${img.versionKey}:2.0.0-$BUILDKITE_BUILD_NUMBER`,
    `--tags ghcr.io/${img.versionKey}:latest`,
    `--registry-username shepherdjerred`,
    `--registry-password env:GH_TOKEN`,
  ].join(" ");

  const NO_SOURCE_PUSHES = new Set([
    "push-dns-audit-image",
    "push-caddy-s-3-proxy-image",
    "push-obsidian-headless-image",
  ]);
  const flags = depFlags(pkg);

  let pushCall: string;
  if (img.pushFn && NO_SOURCE_PUSHES.has(pushFn)) {
    pushCall = `${pushFn} ${tagFlags}`;
  } else if (img.pushFn) {
    // Custom push functions take --pkg-dir + dep flags + tags + registry creds
    pushCall = [`${pushFn} --pkg-dir ./packages/${pkg}`, flags, tagFlags]
      .filter(Boolean)
      .join(" ");
  } else {
    // Default push-image takes --pkg-dir, --pkg, dep flags, tags, registry creds
    const flags = depFlags(pkg);
    pushCall = [
      `push-image --pkg-dir ./packages/${pkg} --pkg ${img.name}`,
      flags,
      tagFlags,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const cmd = [
    // $$ escapes survive Buildkite interpolation so bash sees $DIGEST at runtime.
    // Dagger outputs ANSI escape codes even with DAGGER_PROGRESS=dots/plain,
    // so we strip them before grepping for the sha256 digest.
    `RAW=$$(dagger call ${pushCall})`,
    `&& CLEAN=$$(printf '%s' "$$RAW" | sed 's/\\x1b\\[[0-9;]*[a-zA-Z]//g' | tr -d '\\r')`,
    `&& DIGEST=$$(echo "$$CLEAN" | grep -oE 'sha256:[a-f0-9]+' | head -1)`,
    `&& if [ -z "$$DIGEST" ]; then echo "ERROR: empty digest for ${img.name} — raw output was: $$RAW" >&2; exit 1; fi`,
    `&& buildkite-agent meta-data set "digest:${img.versionKey}" "$$DIGEST"`,
  ].join(" ");

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

// ---------------------------------------------------------------------------
// Key helpers for downstream dependency wiring
// ---------------------------------------------------------------------------

export function allPushKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `push-${safeKey(img.name)}`);
}

export function allBuildKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `build-${safeKey(img.name)}`);
}
