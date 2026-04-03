/**
 * CI orchestration helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 * The ciAll wrapper in index.ts uses these to build the full CI pipeline.
 */
import { dag, Container, Directory, Secret } from "@dagger.io/dagger";

import { BUN_IMAGE, ESLINT_CACHE, GOLANGCI_LINT_VERSION } from "./constants";

import { WORKSPACE_DEPS } from "./deps";

import { bunBaseContainer, rustBaseContainer, goBaseContainer } from "./base";

import { formatSummary, formatFailureDetails } from "./ci-format";

import type { CheckResult } from "./ci-format";

export type { CheckResult };

// Re-export for external use
export { formatSummary, formatFailureDetails };

/** Run a check and capture the full error on failure. */
export function check(
  label: string,
  container: Container,
): Promise<CheckResult> {
  return container
    .stdout()
    .then((): CheckResult => ({ label, status: "PASS" }))
    .catch(
      (e: Error): CheckResult => ({
        label,
        status: "FAIL",
        error: e.message,
      }),
    );
}

// ---------------------------------------------------------------------------
// CI orchestration
// ---------------------------------------------------------------------------

/** Run lint/typecheck/test for all TS packages in parallel. Returns results summary. */
export async function ciAllHelper(
  source: Directory,
  hassToken: Secret | null = null,
): Promise<string> {
  const tsPackages = Object.keys(WORKSPACE_DEPS);

  const tsconfig = source.file("tsconfig.base.json");

  // Helper: extract pkgDir and dep dirs from full source for a package
  const dirsFor = (pkg: string) => {
    const pkgDir = source.directory(`packages/${pkg}`);
    const deps = WORKSPACE_DEPS[pkg] ?? [];
    const depDirs = deps.map((d: string) => source.directory(`packages/${d}`));
    return { pkgDir, depNames: deps, depDirs };
  };

  const allChecks: Promise<CheckResult>[] = [];

  // Run all TS packages in parallel
  for (const pkg of tsPackages) {
    const { pkgDir, depNames, depDirs } = dirsFor(pkg);
    const base = bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig);
    allChecks.push(
      check(
        `${pkg}: lint`,
        base
          .withMountedCache(
            `/workspace/packages/${pkg}/.eslintcache`,
            dag.cacheVolume(ESLINT_CACHE),
          )
          .withExec(["bun", "run", "lint"]),
      ),
    );
    allChecks.push(
      check(`${pkg}: typecheck`, base.withExec(["bun", "run", "typecheck"])),
    );
    allChecks.push(
      check(`${pkg}: test`, base.withExec(["bun", "run", "test"])),
    );
  }

  // Rust checks
  const rustB = rustBaseContainer(source);
  allChecks.push(
    check(
      "clauderon: fmt",
      rustB
        .withExec(["rustup", "component", "add", "rustfmt"])
        .withExec(["cargo", "fmt", "--check"]),
    ),
  );
  allChecks.push(
    check(
      "clauderon: clippy",
      rustB
        .withExec(["rustup", "component", "add", "clippy"])
        .withExec([
          "cargo",
          "clippy",
          "--all-targets",
          "--all-features",
          "--",
          "-D",
          "warnings",
        ]),
    ),
  );
  allChecks.push(
    check(
      "clauderon: test",
      rustB.withExec(["cargo", "test", "--all-features"]),
    ),
  );

  // Go checks
  const goB = goBaseContainer(source);
  allChecks.push(check("go: build", goB.withExec(["go", "build", "./..."])));
  allChecks.push(
    check("go: test", goB.withExec(["go", "test", "./...", "-v"])),
  );
  allChecks.push(
    check(
      "go: lint",
      goB
        .withExec([
          "go",
          "install",
          `github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}`,
        ])
        .withExec(["golangci-lint", "run", "./..."]),
    ),
  );

  // scout-for-lol: generate then lint/typecheck/test
  const scoutInfo = dirsFor("scout-for-lol");
  const scoutGenerated = bunBaseContainer(
    scoutInfo.pkgDir,
    "scout-for-lol",
    scoutInfo.depNames,
    scoutInfo.depDirs,
    tsconfig,
  )
    .withExec(["bun", "run", "generate"])
    .directory("/workspace");
  const scoutContainer = dag
    .container()
    .from(BUN_IMAGE)
    .withDirectory("/workspace", scoutGenerated)
    .withWorkdir("/workspace/packages/scout-for-lol");
  allChecks.push(
    check(
      "scout-for-lol: lint",
      scoutContainer.withExec(["bun", "run", "lint"]),
    ),
  );
  allChecks.push(
    check(
      "scout-for-lol: typecheck",
      scoutContainer.withExec(["bun", "run", "typecheck"]),
    ),
  );
  allChecks.push(
    check(
      "scout-for-lol: test",
      scoutContainer.withExec(["bun", "run", "test"]),
    ),
  );

  // homelab/ha: generate types then lint/typecheck (requires HASS_TOKEN)
  if (hassToken != null) {
    const haInfo = dirsFor("homelab/src/ha");
    const haGenerated = bunBaseContainer(
      haInfo.pkgDir,
      "homelab/src/ha",
      haInfo.depNames,
      haInfo.depDirs,
      tsconfig,
    )
      .withSecretVariable("HASS_TOKEN", hassToken)
      .withEnvVariable("HASS_BASE_URL", "https://homeassistant.sjer.red")
      .withExec(["bun", "run", "generate-types"])
      .directory("/workspace");
    const haContainer = dag
      .container()
      .from(BUN_IMAGE)
      .withDirectory("/workspace", haGenerated)
      .withWorkdir("/workspace/packages/homelab/src/ha");
    allChecks.push(
      check("homelab/ha: lint", haContainer.withExec(["bun", "run", "lint"])),
    );
    allChecks.push(
      check(
        "homelab/ha: typecheck",
        haContainer.withExec(["bun", "run", "typecheck"]),
      ),
    );
  }

  // Wait for all checks to complete
  const results = await Promise.all(allChecks);

  // Build summary
  const failures = results.filter((r) => r.status === "FAIL");
  const summary = formatSummary(results, hassToken != null);

  if (failures.length > 0) {
    const details = formatFailureDetails(failures);
    throw new Error(
      `${failures.length} check(s) failed:\n\n${summary}\n\n${details}`,
    );
  }

  return summary;
}
