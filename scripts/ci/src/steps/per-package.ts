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
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

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
    // Prisma CLI requires Node.js, so install it as an extra apt package
    const prismaFlags = `${pf} --extra-apt-packages nodejs --extra-apt-packages npm`;
    steps.push(
      daggerCallStep(
        `:eslint: Lint`,
        `lint-${sk}`,
        `dagger call generate-and-lint ${prismaFlags}`,
        resources,
      ),
      daggerCallStep(
        `:typescript: Typecheck`,
        `typecheck-${sk}`,
        `dagger call generate-and-typecheck ${prismaFlags}`,
        resources,
      ),
      daggerCallStep(
        `:test_tube: Test`,
        `test-${sk}`,
        `dagger call generate-and-test ${prismaFlags}`,
        resources,
      ),
    );
  } else {
    steps.push(
      daggerCallStep(
        `:eslint: Lint`,
        `lint-${sk}`,
        `dagger call lint ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:typescript: Typecheck`,
        `typecheck-${sk}`,
        `dagger call typecheck ${pf}`,
        resources,
      ),
    );

    if (PLAYWRIGHT_PACKAGES.has(pkg)) {
      // Playwright tests need a browser container, not bunBase
      steps.push(
        daggerCallStep(
          `:performing_arts: Playwright Test`,
          `playwright-test-${sk}`,
          `dagger call playwright-test ${pf}`,
          resources,
        ),
      );
    } else {
      steps.push(
        daggerCallStep(
          `:test_tube: Test`,
          `test-${sk}`,
          `dagger call test ${pf}`,
          resources,
        ),
      );
    }
  }

  // homelab: add HA lint/typecheck steps that generate types with HASS_TOKEN
  // haLint/haTypecheck have no --pkg param (pkg is hardcoded in haGenerate)
  if (pkg === "homelab") {
    const haDeps = WORKSPACE_DEPS["homelab/src/ha"] ?? [];
    const haFlags = [
      `--pkg-dir ./packages/homelab/src/ha`,
      ...haDeps.flatMap((dep) => [
        `--dep-names ${dep}`,
        `--dep-dirs ./packages/${dep}`,
      ]),
      `--tsconfig ./tsconfig.base.json`,
      `--homelab-tsconfig ./packages/homelab/tsconfig.base.json`,
    ].join(" ");
    steps.push(
      daggerCallStep(
        `:house: HA Lint`,
        `ha-lint-${sk}`,
        `dagger call ha-lint ${haFlags} --hass-token env:HASS_TOKEN`,
        resources,
      ),
      daggerCallStep(
        `:house: HA Typecheck`,
        `ha-typecheck-${sk}`,
        `dagger call ha-typecheck ${haFlags} --hass-token env:HASS_TOKEN`,
        resources,
      ),
    );
  }

  if (ASTRO_PACKAGES.has(pkg)) {
    steps.push(
      daggerCallStep(
        `:rocket: Astro Check`,
        `astro-check-${sk}`,
        `dagger call astro-check ${pf}`,
        resources,
      ),
      daggerCallStep(
        `:building_construction: Astro Build`,
        `astro-build-${sk}`,
        `dagger call astro-build ${pf}`,
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

function rustPackageGroup(sk: string): BuildkiteGroup {
  const resources = PACKAGE_RESOURCES["clauderon"] ?? DEFAULT_RESOURCES;
  return {
    group: `:dagger_knife: clauderon`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(
        `:art: Fmt`,
        `fmt-${sk}`,
        `dagger call rust-fmt --pkg-dir ./packages/clauderon`,
        resources,
      ),
      daggerCallStep(
        `:mag: Clippy`,
        `clippy-${sk}`,
        `dagger call rust-clippy --pkg-dir ./packages/clauderon`,
        resources,
      ),
      daggerCallStep(
        `:test_tube: Test`,
        `test-${sk}`,
        `dagger call rust-test --pkg-dir ./packages/clauderon`,
        resources,
      ),
      daggerCallStep(
        `:shield: Cargo Deny`,
        `cargo-deny-${sk}`,
        `dagger call cargo-deny --pkg-dir ./packages/clauderon`,
        resources,
      ),
    ],
  };
}

function goPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: terraform-provider-asuswrt`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(
        `:building_construction: Build`,
        `build-${sk}`,
        `dagger call go-build --pkg-dir ./packages/terraform-provider-asuswrt`,
        DEFAULT_RESOURCES,
      ),
      daggerCallStep(
        `:test_tube: Test`,
        `test-${sk}`,
        `dagger call go-test --pkg-dir ./packages/terraform-provider-asuswrt`,
        DEFAULT_RESOURCES,
      ),
      daggerCallStep(
        `:mag: Lint`,
        `lint-${sk}`,
        `dagger call go-lint --pkg-dir ./packages/terraform-provider-asuswrt`,
        DEFAULT_RESOURCES,
      ),
    ],
  };
}

function javaPackageGroup(sk: string): BuildkiteGroup {
  return {
    group: `:dagger_knife: castle-casters`,
    key: `pkg-${sk}`,
    steps: [
      daggerCallStep(
        `:building_construction: Maven Build`,
        `maven-build-${sk}`,
        `dagger call maven-build --pkg-dir ./packages/castle-casters`,
        PACKAGE_RESOURCES["castle-casters"] ?? DEFAULT_RESOURCES,
      ),
      daggerCallStep(
        `:test_tube: Maven Test`,
        `maven-test-${sk}`,
        `dagger call maven-test --pkg-dir ./packages/castle-casters`,
        PACKAGE_RESOURCES["castle-casters"] ?? DEFAULT_RESOURCES,
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
        `dagger call latex-build --pkg-dir ./packages/resume`,
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
