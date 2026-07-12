/**
 * Image build and push step generators.
 *
 * Build and smoke steps run on every branch (PRs included) — they are pure
 * validation with no production side effect. Change-detection scopes them to
 * actually-affected packages (see scripts/ci/src/change-detection.ts).
 *
 * Push steps stay gated to `MAIN_ONLY` because they need GHCR credentials and
 * publish a versioned artifact. Anything below MAIN_ONLY-gated should produce
 * a real production side effect; pure validation runs on PRs.
 */
import type { ImageTarget } from "../catalog.ts";
import {
  IMAGE_PUSH_TARGETS,
  PRISMA_PACKAGES,
  EDITOR_CLI_PACKAGES,
} from "../catalog.ts";
import {
  safeKey,
  RETRY,
  DAGGER_ENV,
  gitDir,
  gitFile,
  DAGGER_CALL,
  REPO_GIT_REF,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

// Every custom build/push @func() in .dagger/src/index.ts accepts `version`
// and `gitSha` parameters. Without these flags they fall back to "dev" /
// "unknown", which ends up as VERSION/GIT_SHA env vars inside the image —
// and then as the Bugsink/Sentry `release` tag — so leaving them off makes
// release-keyed regression tracking useless. Always pass them.
const VERSION_FLAGS = `--version "2.0.0-$BUILDKITE_BUILD_NUMBER" --git-sha "$BUILDKITE_COMMIT"`;

function depFlags(pkg: string): string {
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  return deps
    .flatMap((d: string) => [
      `--dep-names ${d}`,
      `--dep-dirs ${gitDir(`packages/${d}`)}`,
    ])
    .join(" ");
}

// ---------------------------------------------------------------------------
// Build steps (build phase — depends on quality-gate)
// ---------------------------------------------------------------------------

// Image builders whose in-image frontend build (vite 8 / rolldown) resolves a
// package tsconfig that extends the repo root tsconfig.base.json. The dagger
// functions take --tsconfig and mount it at /workspace/tsconfig.base.json,
// mirroring the pkg-check containers.
const TSCONFIG_IMAGES = new Set([
  "discord-plays-pokemon",
  "discord-plays-mario-kart",
]);

function tsconfigFlag(imgName: string): string {
  return TSCONFIG_IMAGES.has(imgName)
    ? `--tsconfig ${gitFile("tsconfig.base.json")}`
    : "";
}

function imageBuildStep(
  img: ImageTarget,
  dependsOn: string | string[] = "quality-gate",
): BuildkiteStep {
  const pkg = img.package ?? img.name;
  const buildFn = img.buildFn ?? "build-image";

  // Custom build functions that need no local source (built from upstream images only)
  const NO_SOURCE_BUILDS = new Set([
    "build-caddy-s-3-proxy-image",
    "build-obsidian-headless-image",
    "build-mcp-gateway-image",
    "build-redlib-image",
  ]);

  const flags = depFlags(pkg);
  let cmd: string;
  if (img.buildFn && NO_SOURCE_BUILDS.has(buildFn)) {
    cmd = [`${DAGGER_CALL} ${buildFn}`, VERSION_FLAGS].join(" ");
  } else if (img.buildFn) {
    // Custom build functions take --pkg-dir + dep flags (no --pkg)
    cmd = [
      `${DAGGER_CALL} ${buildFn} --pkg-dir ${gitDir(`packages/${pkg}`)}`,
      flags,
      tsconfigFlag(img.name),
      VERSION_FLAGS,
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    // Default build-image takes --pkg-dir, --pkg, and dep flags
    const prismaFlag = PRISMA_PACKAGES.has(img.name) ? "--use-prisma" : "";
    const editorClisFlag = EDITOR_CLI_PACKAGES.has(img.name)
      ? "--install-editor-clis"
      : "";
    cmd = [
      `${DAGGER_CALL} ${buildFn} --pkg-dir ${gitDir(`packages/${pkg}`)} --pkg ${img.name}`,
      prismaFlag,
      editorClisFlag,
      flags,
      VERSION_FLAGS,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    label: `:docker: Build ${img.name}`,
    key: `build-${safeKey(img.name)}`,
    depends_on: dependsOn,
    command: cmd,
    // 45 min: a cold image build (post cache-wipe) measured 32 min for the
    // dpp smoke and >15 min for temporal-worker on 2026-07-04 — the old 15 min
    // ceiling made a cold rebuild permanently unable to warm its own cache.
    timeout_in_minutes: 45,
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
  "caddy-s3proxy": "smoke-test-caddy-s-3-proxy",
  "obsidian-headless": "smoke-test-obsidian-headless",
  "mcp-gateway": "smoke-test-mcp-gateway",
  "discord-plays-pokemon": "smoke-test-discord-plays-pokemon",
  streambot: "smoke-test-streambot",
  "discord-plays-mario-kart": "smoke-test-discord-plays-mario-kart",
  "trmnl-dashboard": "smoke-test-trmnl-dashboard",
  // Not a startup smoke: rehearses the scheduled PR-creating workflows'
  // environment (bot-clone install/build/commit paths) inside the built
  // worker image, against the full repo tree at $BUILDKITE_COMMIT. See
  // packages/temporal/scripts/rehearse-bot-clone.ts.
  "temporal-worker": "temporal-schedule-rehearsal",
};

// Smoke test functions that take no arguments (standalone images)
const SMOKE_NO_ARGS = new Set([
  "smoke-test-caddy-s-3-proxy",
  "smoke-test-obsidian-headless",
  "smoke-test-mcp-gateway",
]);

// Smoke test functions that take --pkg-dir + dep flags but no --pkg (custom infra images / workspace monorepos)
const SMOKE_CUSTOM_INFRA = new Set([
  "smoke-test-scout-for-lol",
  "smoke-test-discord-plays-pokemon",
  "smoke-test-discord-plays-mario-kart",
  "smoke-test-streambot",
  "smoke-test-trmnl-dashboard",
]);

// Smoke test functions that additionally take the whole repo tree as
// --repo-dir (the temporal schedule rehearsal validates repo-wide paths the
// weekly jobs depend on: cog targets, scout workspace, root install).
const SMOKE_REPO_TREE = new Set(["temporal-schedule-rehearsal"]);

/**
 * Combined "build + smoke" step. Each smoke `@func()` in `.dagger/src/`
 * already builds its image internally before running the smoke verification,
 * so the engine de-dups against the standalone build (one engine-side build
 * either way). Bundling them at the BK layer drops a pod and a sidecar tax
 * per smokeable image. For images without a smoke test we still emit a plain
 * `build-<img>` step in {@link buildImagesWithSmokeGroup} so build failures
 * are caught early.
 */
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
    cmd = `${DAGGER_CALL} ${daggerFn}`;
  } else if (SMOKE_REPO_TREE.has(daggerFn)) {
    cmd = [
      `${DAGGER_CALL} ${daggerFn} --pkg-dir ${gitDir(`packages/${pkg}`)}`,
      `--repo-dir ${REPO_GIT_REF}`,
      flags,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (SMOKE_CUSTOM_INFRA.has(daggerFn)) {
    cmd = [
      `${DAGGER_CALL} ${daggerFn} --pkg-dir ${gitDir(`packages/${pkg}`)}`,
      flags,
      tsconfigFlag(img.name),
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    cmd = [
      `${DAGGER_CALL} ${daggerFn}`,
      `--pkg-dir ${gitDir(`packages/${pkg}`)} --pkg ${img.name}`,
      flags,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    label: `:package::heartbeat: Build + Smoke ${img.name}`,
    key: `smoke-${safeKey(img.name)}`,
    depends_on: dependsOn,
    command: cmd,
    // 45 min: a cold image build (post cache-wipe) measured 32 min for the
    // dpp smoke and >15 min for temporal-worker on 2026-07-04 — the old 15 min
    // ceiling made a cold rebuild permanently unable to warm its own cache.
    timeout_in_minutes: 45,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "150m",
        memory: "384Mi",
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
    `--registry-password env:GHCR_TOKEN`,
  ].join(" ");

  const NO_SOURCE_PUSHES = new Set([
    "push-caddy-s-3-proxy-image",
    "push-obsidian-headless-image",
    "push-mcp-gateway-image",
    "push-redlib-image",
  ]);
  const flags = depFlags(pkg);

  let pushCall: string;
  if (img.pushFn && NO_SOURCE_PUSHES.has(pushFn)) {
    pushCall = [pushFn, tagFlags, VERSION_FLAGS].join(" ");
  } else if (img.pushFn) {
    // Custom push functions take --pkg-dir + dep flags + tags + registry creds
    pushCall = [
      `${pushFn} --pkg-dir ${gitDir(`packages/${pkg}`)}`,
      flags,
      tsconfigFlag(img.name),
      tagFlags,
      VERSION_FLAGS,
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    // Default push-image takes --pkg-dir, --pkg, dep flags, tags, registry creds
    const prismaFlag = PRISMA_PACKAGES.has(img.name) ? "--use-prisma" : "";
    const editorClisFlag = EDITOR_CLI_PACKAGES.has(img.name)
      ? "--install-editor-clis"
      : "";
    pushCall = [
      `push-image --pkg-dir ${gitDir(`packages/${pkg}`)} --pkg ${img.name}`,
      prismaFlag,
      editorClisFlag,
      flags,
      tagFlags,
      VERSION_FLAGS,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const cmd = [
    `if [ -z "$$GHCR_TOKEN" ] && [ -n "$$GH_TOKEN" ]; then echo "WARNING: GHCR_TOKEN unset, falling back to GH_TOKEN for GHCR push" >&2; fi`,
    '&& export GHCR_TOKEN="$${GHCR_TOKEN:-$${GH_TOKEN:-}}"',
    `&& if [ -z "$$GHCR_TOKEN" ]; then echo "ERROR: GHCR_TOKEN is empty and GH_TOKEN fallback is unavailable" >&2; exit 1; fi`,
    // $$ escapes survive Buildkite interpolation so bash sees $DIGEST at runtime.
    // Dagger outputs ANSI escape codes even with DAGGER_PROGRESS=dots/plain,
    // so we strip them before grepping for the sha256 digest.
    `&& RAW=$$(${DAGGER_CALL} ${pushCall})`,
    String.raw`&& CLEAN=$$(printf '%s' "$$RAW" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | tr -d '\r')`,
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
    // 45 min: a cold image build (post cache-wipe) measured 32 min for the
    // dpp smoke and >15 min for temporal-worker on 2026-07-04 — the old 15 min
    // ceiling made a cold rebuild permanently unable to warm its own cache.
    timeout_in_minutes: 45,
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

    // For smokeable images, the smoke step already builds + smokes in one
    // Dagger call — skip the standalone `build-<img>` BK step. For
    // non-smokeable images, emit the build step alone so failures surface.
    const smoke = smokeTestStep(img, buildDeps);
    if (smoke) {
      steps.push(smoke);
    } else {
      steps.push(imageBuildStep(img, buildDeps));
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
