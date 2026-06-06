/**
 * Per-package step generator: lint, typecheck, test for each affected package.
 */
import {
  PACKAGE_RESOURCES,
  DEFAULT_RESOURCES,
  PRISMA_PACKAGES,
  ASTRO_PACKAGES,
  SKIP_PACKAGES,
  PLAYWRIGHT_PACKAGES,
  NPM_BUILD_PACKAGES,
} from "../catalog.ts";
import {
  safeKey,
  RETRY,
  DAGGER_ENV,
  DAGGER_CALL,
  REPO_GIT_REF,
  gitDir,
  gitFile,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

// Import the same dependency map used by the Dagger module
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

/**
 * Build Dagger CLI flags for per-package operations.
 * Generates --pkg-dir, --dep-names, --dep-dirs, --tsconfig flags.
 *
 * Paths are git-URL refs (see `gitDir`/`gitFile` in lib/buildkite.ts), so
 * the Dagger engine fetches each subdir from the public monorepo at
 * `$BUILDKITE_COMMIT` instead of the BK pod uploading a local working tree.
 */
function daggerPkgFlags(pkg: string): string {
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  const flags = [`--pkg-dir ${gitDir(`packages/${pkg}`)}`, `--pkg ${pkg}`];
  for (const dep of deps) {
    flags.push(`--dep-names ${dep}`, `--dep-dirs ${gitDir(`packages/${dep}`)}`);
  }
  flags.push(`--tsconfig ${gitFile("tsconfig.base.json")}`);
  return flags.join(" ");
}

/** Generate per-package build/test groups for a single package, or null if skipped. */
export function perPackageSteps(pkg: string): BuildkiteGroup | null {
  if (SKIP_PACKAGES.has(pkg)) return null;

  const sk = safeKey(pkg);
  const resources = PACKAGE_RESOURCES[pkg] ?? DEFAULT_RESOURCES;

  // Determine which type of package this is
  if (pkg === "terraform-provider-asuswrt") return goPackageGroup(sk);
  if (pkg === "resume") return latexPackageGroup(sk);

  // Standard Bun/TS package
  const steps: BuildkiteStep[] = [];

  const pf = daggerPkgFlags(pkg);

  if (PRISMA_PACKAGES.has(pkg)) {
    // Prisma: combined generate+action in a single dagger pipeline (avoids nested CLI calls)
    steps.push(
      daggerCallStep(
        `:eslint: Lint`,
        `lint-${sk}`,
        `${DAGGER_CALL} generate-and-lint ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:typescript: Typecheck`,
        `typecheck-${sk}`,
        `${DAGGER_CALL} generate-and-typecheck ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:test_tube: Test`,
        `test-${sk}`,
        `${DAGGER_CALL} generate-and-test ${pf}`,
        resources,
      ),
    );
  } else {
    // temporal: typecheck needs HASS_URL/HASS_TOKEN to run ha-codegen against
    // the live Home Assistant instance and produce the typed schema before
    // tsc. Without secrets the generate script falls back to the committed
    // stub (loose types). Secrets come from `buildkite-ci-secrets` (mounted
    // by the k8s plugin on every step) — add HASS_URL / HASS_TOKEN fields to
    // the 1Password item backing that secret to enable strict CI typing.
    // Inside the Dagger container the secrets are re-bound to HA_URL /
    // HA_TOKEN (what the ha-codegen CLI reads); only the outer env lookup
    // uses the HASS_ prefix.
    const typecheckCmd =
      pkg === "temporal"
        ? `${DAGGER_CALL} generate-and-typecheck-with-secrets ${pf} --ha-url env:HASS_URL --ha-token env:HASS_TOKEN`
        : `${DAGGER_CALL} typecheck ${pf}`;
    steps.push(
      daggerCallStep(
        `:eslint: Lint`,
        `lint-${sk}`,
        `${DAGGER_CALL} lint ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:typescript: Typecheck`,
        `typecheck-${sk}`,
        typecheckCmd,
        resources,
      ),
    );

    if (PLAYWRIGHT_PACKAGES.has(pkg)) {
      // Playwright tests need a browser container, not bunBase
      steps.push(
        daggerCallStep(
          `:performing_arts: Playwright Test`,
          `playwright-test-${sk}`,
          `${DAGGER_CALL} playwright-test ${pf}`,
          resources,
        ),
      );
    } else {
      const needsHelm = pkg === "homelab" ? " --needs-helm" : "";
      steps.push(
        daggerCallStep(
          `:test_tube: Test`,
          `test-${sk}`,
          `${DAGGER_CALL} test ${pf}${needsHelm}`,
          resources,
        ),
      );
    }
  }

  if (pkg === "tasks-for-obsidian") {
    steps.push(tasksForObsidianNativeDepsStep(resources));
  }

  // homelab: build helm-types (nested NPM package under homelab).
  // No artifact upload — npm publish rebuilds via Dagger cache.
  if (pkg === "homelab") {
    const htPkg = "homelab/src/helm-types";
    const htFlags = daggerPkgFlags(htPkg);
    steps.push(
      daggerCallStep(
        `:building_construction: Build helm-types`,
        `build-helm-types`,
        `${DAGGER_CALL} build-package ${htFlags}`,
        resources,
      ),
    );
  }

  if (ASTRO_PACKAGES.has(pkg)) {
    steps.push(
      daggerCallStep(
        `:rocket: Astro Check`,
        `astro-check-${sk}`,
        `${DAGGER_CALL} astro-check ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:building_construction: Astro Build`,
        `astro-build-${sk}`,
        `${DAGGER_CALL} astro-build ${pf}`,
        resources,
      ),
    );
  }

  // NPM-publishable packages: build to warm Dagger cache (npm publish rebuilds via cache hit).
  // No Buildkite artifact upload — Dagger caching handles build output transfer.
  if (NPM_BUILD_PACKAGES.has(pkg)) {
    steps.push(
      daggerCallStep(
        `:building_construction: Build`,
        `build-${sk}`,
        `${DAGGER_CALL} build-package ${pf}`,
        resources,
      ),
    );
  }

  return {
    group: `:dagger_knife: ${pkg}`,
    key: `pkg-${sk}`,
    steps,
  };
}

function goPackageGroup(sk: string): BuildkiteGroup {
  const goPkgDir = gitDir("packages/terraform-provider-asuswrt");
  return {
    group: `:dagger_knife: terraform-provider-asuswrt`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(
        `:building_construction: Build`,
        `build-${sk}`,
        `${DAGGER_CALL} go-build --pkg-dir ${goPkgDir}`,
        DEFAULT_RESOURCES,
      ),
      daggerCallStep(
        `:test_tube: Test`,
        `test-${sk}`,
        `${DAGGER_CALL} go-test --pkg-dir ${goPkgDir}`,
        DEFAULT_RESOURCES,
      ),
      daggerCallStep(
        `:mag: Lint`,
        `lint-${sk}`,
        `${DAGGER_CALL} go-lint --pkg-dir ${goPkgDir}`,
        DEFAULT_RESOURCES,
      ),
    ],
  };
}

function latexPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: resume`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(
        `:page_facing_up: LaTeX Build`,
        `latex-build-${sk}`,
        `${DAGGER_CALL} latex-build --pkg-dir ${gitDir("packages/resume")}`,
        DEFAULT_RESOURCES,
      ),
    ],
  };
}

function daggerCallStep(
  label: string,
  key: string,
  command: string,
  resources: { cpu: string; memory: string },
  dependsOn?: string,
): BuildkiteStep {
  const step: BuildkiteStep = {
    label,
    key,
    command,
    timeout_in_minutes: 30,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: resources.cpu, memory: resources.memory })],
  };
  if (dependsOn) {
    step.depends_on = dependsOn;
  }
  return step;
}

/**
 * iOS native deps check — runs `bun install --linker hoisted` and
 * `bun run check:ios-native-deps` for `packages/tasks-for-obsidian` inside
 * the Dagger engine. Source comes from the git URL ref (no BK checkout).
 * Replaces the previous plainStep that ran
 * `.buildkite/scripts/tasks-for-obsidian-ios-native-deps.sh` against a
 * local working tree.
 */
function tasksForObsidianNativeDepsStep(resources: {
  cpu: string;
  memory: string;
}): BuildkiteStep {
  return {
    label: ":iphone: iOS Native Deps",
    key: "ios-native-deps-tasks-for-obsidian",
    command: `${DAGGER_CALL} tasks-for-obsidian-ios-native-deps --source ${REPO_GIT_REF}`,
    timeout_in_minutes: 10,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: resources.cpu, memory: resources.memory })],
  };
}
