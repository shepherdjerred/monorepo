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

/**
 * Generate per-package build/test groups for a single package, or null if
 * skipped. `helmTypesInputsChanged` gates the homelab helm-types drift-check
 * step (only emitted when a generator input changed — see change-detection).
 */
export function perPackageSteps(
  pkg: string,
  helmTypesInputsChanged = false,
): BuildkiteGroup | null {
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
    // Prisma: one bundled pod runs generate-and-{lint,typecheck,test} in
    // parallel via Promise.all. The engine de-dups the shared generate layer.
    steps.push(
      daggerCallStep(
        `:dagger_knife: Lint + Typecheck + Test`,
        `pkg-check-${sk}`,
        `${DAGGER_CALL} generate-and-lint-typecheck-test ${pf}`,
        resources,
      ),
    );
  } else if (PLAYWRIGHT_PACKAGES.has(pkg)) {
    // Playwright runs in a different base container (PLAYWRIGHT_IMAGE) and
    // needs a full astro build first — keep it as its own step. Bundle just
    // the bun-base lint + typecheck into one pod (--skip-test, because
    // sjer.red's `bun run test` chains an astro build + playwright that
    // belong on the playwright container, not bunBase).
    steps.push(
      daggerCallStep(
        `:dagger_knife: Lint + Typecheck`,
        `pkg-check-${sk}`,
        `${DAGGER_CALL} lint-typecheck-test ${pf} --skip-test`,
        resources,
      ),
      daggerCallStep(
        `:performing_arts: Playwright Test`,
        `playwright-test-${sk}`,
        `${DAGGER_CALL} playwright-test ${pf}`,
        resources,
      ),
    );
  } else {
    // Standard bun package — one bundled pod runs lint + typecheck + test
    // (plus optional astro / build siblings) in parallel.
    //
    // temporal: typecheck needs HASS_URL/HASS_TOKEN so ha-codegen runs
    // against the live HA instance before tsc. Secrets come from
    // `buildkite-ci-secrets` (mounted by the k8s plugin on every step);
    // inside the Dagger container they're re-bound to HA_URL / HA_TOKEN.
    //
    // ASTRO_PACKAGES (sjer.red, cooklang-rich-preview): astro-check +
    // astro-build run as additional parallel siblings inside the bundle.
    // NPM_BUILD_PACKAGES (astro-opengraph-images, webring): `bun run build`
    // runs as a parallel sibling to warm the Dagger cache for npm publish.
    const haFlags =
      pkg === "temporal"
        ? ` --ha-url env:HASS_URL --ha-token env:HASS_TOKEN`
        : "";
    const helmFlag = pkg === "homelab" ? ` --needs-helm` : "";
    const astroFlags = ASTRO_PACKAGES.has(pkg)
      ? ` --include-astro-check --include-astro-build`
      : "";
    const buildFlag = NPM_BUILD_PACKAGES.has(pkg) ? ` --include-build` : "";
    steps.push(
      daggerCallStep(
        `:dagger_knife: pkg-check`,
        `pkg-check-${sk}`,
        `${DAGGER_CALL} lint-typecheck-test ${pf}${helmFlag}${haFlags}${astroFlags}${buildFlag}`,
        resources,
      ),
    );
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

    // Regenerate the committed Helm value types and fail if they drift. Scoped
    // to PRs that touch a generator input (versions.ts / the generate+parse
    // scripts / the helm-types lib) so the ~24-chart network fetch doesn't run
    // on unrelated cdk8s edits. Replaces the weekly helm-types-refresh Temporal
    // workflow: a chart bump that wasn't regenerated now fails CI.
    if (helmTypesInputsChanged) {
      const cdk8sDeps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
      const cdk8sDepFlags = cdk8sDeps
        .flatMap((d) => [
          `--dep-names ${d}`,
          `--dep-dirs ${gitDir(`packages/${d}`)}`,
        ])
        .join(" ");
      steps.push(
        daggerCallStep(
          `:helm: Helm types drift check`,
          `helm-types-drift-check`,
          `${DAGGER_CALL} helm-types-drift-check --pkg-dir ${gitDir("packages/homelab/src/cdk8s")} ${cdk8sDepFlags} --tsconfig ${gitFile("tsconfig.base.json")}`,
          resources,
        ),
      );
    }
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
        `:dagger_knife: Lint + Test + Build`,
        `pkg-check-${sk}`,
        `${DAGGER_CALL} go-lint-test-build --pkg-dir ${goPkgDir}`,
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
