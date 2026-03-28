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
} from "../catalog.ts";
import { safeKey, RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

// Import the same dependency map used by the Dagger module
import { WORKSPACE_DEPS } from "../lib/workspace-deps.ts";

/**
 * Build Dagger CLI flags for per-package operations.
 * Generates --pkg-dir, --dep-names, --dep-dirs, --tsconfig flags.
 */
function daggerPkgFlags(pkg: string): string {
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  const flags = [`--pkg-dir ./packages/${pkg}`, `--pkg ${pkg}`];
  for (const dep of deps) {
    flags.push(`--dep-names ${dep}`, `--dep-dirs ./packages/${dep}`);
  }
  flags.push("--tsconfig ./tsconfig.base.json");
  return flags.join(" ");
}

/** Generate per-package build/test groups for a single package, or null if skipped. */
export function perPackageSteps(pkg: string): BuildkiteGroup | null {
  if (SKIP_PACKAGES.has(pkg)) return null;

  const sk = safeKey(pkg);
  const resources = PACKAGE_RESOURCES[pkg] ?? DEFAULT_RESOURCES;

  // Determine which type of package this is
  if (pkg === "clauderon") return rustPackageGroup(sk);
  if (pkg === "terraform-provider-asuswrt") return goPackageGroup(sk);
  if (pkg === "castle-casters") return javaPackageGroup(sk);
  if (pkg === "resume") return latexPackageGroup(sk);

  // Standard Bun/TS package
  const steps: BuildkiteStep[] = [];

  const pf = daggerPkgFlags(pkg);

  if (PRISMA_PACKAGES.has(pkg)) {
    // Prisma: combined generate+action in a single dagger pipeline (avoids nested CLI calls)
    steps.push(
      daggerCallStep(`:eslint: Lint`, `lint-${sk}`, `dagger call generate-and-lint ${pf}`, resources),
      daggerCallStep(`:typescript: Typecheck`, `typecheck-${sk}`, `dagger call generate-and-typecheck ${pf}`, resources),
      daggerCallStep(`:test_tube: Test`, `test-${sk}`, `dagger call generate-and-test ${pf}`, resources),
    );
  } else {
    steps.push(
      daggerCallStep(`:eslint: Lint`, `lint-${sk}`, `dagger call lint ${pf}`, resources),
      daggerCallStep(`:typescript: Typecheck`, `typecheck-${sk}`, `dagger call typecheck ${pf}`, resources),
    );

    if (PLAYWRIGHT_PACKAGES.has(pkg)) {
      // Playwright tests need a browser container, not bunBase
      steps.push(
        daggerCallStep(`:performing_arts: Playwright Test`, `playwright-test-${sk}`, `dagger call playwright-test ${pf}`, resources),
      );
    } else {
      steps.push(
        daggerCallStep(`:test_tube: Test`, `test-${sk}`, `dagger call test ${pf}`, resources),
      );
    }
  }

  // homelab: add HA lint/typecheck steps that generate types with HASS_TOKEN
  if (pkg === "homelab") {
    const haFlags = daggerPkgFlags("homelab/src/ha");
    steps.push(
      daggerCallStep(`:house: HA Lint`, `ha-lint-${sk}`, `dagger call ha-lint ${haFlags} --hass-token env:HASS_TOKEN`, resources),
      daggerCallStep(`:house: HA Typecheck`, `ha-typecheck-${sk}`, `dagger call ha-typecheck ${haFlags} --hass-token env:HASS_TOKEN`, resources),
    );
  }

  if (ASTRO_PACKAGES.has(pkg)) {
    steps.push(
      daggerCallStep(`:rocket: Astro Check`, `astro-check-${sk}`, `dagger call astro-check ${pf}`, resources),
      daggerCallStep(`:building_construction: Astro Build`, `astro-build-${sk}`, `dagger call astro-build ${pf}`, resources),
    );
  }

  return {
    group: `:dagger_knife: ${pkg}`,
    key: `pkg-${sk}`,
    steps,
  };
}

function rustPackageGroup(sk: string): BuildkiteGroup {
  const resources = PACKAGE_RESOURCES["clauderon"] ?? DEFAULT_RESOURCES;
  return {
    group: `:dagger_knife: clauderon`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(`:art: Fmt`, `fmt-${sk}`, `dagger call rust-fmt --source .`, resources),
      daggerCallStep(`:mag: Clippy`, `clippy-${sk}`, `dagger call rust-clippy --source .`, resources),
      daggerCallStep(`:test_tube: Test`, `test-${sk}`, `dagger call rust-test --source .`, resources),
      daggerCallStep(`:shield: Cargo Deny`, `cargo-deny-${sk}`, `dagger call cargo-deny --source .`, resources),
    ],
  };
}

function goPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: terraform-provider-asuswrt`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(`:building_construction: Build`, `build-${sk}`, `dagger call go-build --source .`, DEFAULT_RESOURCES),
      daggerCallStep(`:test_tube: Test`, `test-${sk}`, `dagger call go-test --source .`, DEFAULT_RESOURCES),
      daggerCallStep(`:mag: Lint`, `lint-${sk}`, `dagger call go-lint --source .`, DEFAULT_RESOURCES),
    ],
  };
}

function javaPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: castle-casters`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(`:building_construction: Maven Build`, `maven-build-${sk}`, `dagger call maven-build --source .`, PACKAGE_RESOURCES["castle-casters"] ?? DEFAULT_RESOURCES),
      daggerCallStep(`:test_tube: Maven Test`, `maven-test-${sk}`, `dagger call maven-test --source .`, PACKAGE_RESOURCES["castle-casters"] ?? DEFAULT_RESOURCES),
    ],
  };
}

function latexPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: resume`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(`:page_facing_up: LaTeX Build`, `latex-build-${sk}`, `dagger call latex-build --source .`, DEFAULT_RESOURCES),
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
