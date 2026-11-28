import {
  dependencyClosure,
  loadWorkspaces,
  type WorkspacePackage,
} from "../selectors/select-image-targets-workspaces.ts";
import { globalPaths } from "../migration-core.ts";

/**
 * `test:e2e` runs a Playwright project; `test:browser` runs Vitest browser-mode
 * suites. Both need the Playwright image's browsers, so they share this lane.
 */
export type PlaywrightTask = "test:e2e" | "test:browser";

export type PlaywrightTarget = {
  readonly package: string;
  readonly reportDirectory: string;
  /** Defaults to `test:e2e`. */
  readonly task?: PlaywrightTask;
};

export function playwrightTask(target: PlaywrightTarget): PlaywrightTask {
  return target.task ?? "test:e2e";
}

export const PLAYWRIGHT_TARGETS: readonly PlaywrightTarget[] = [
  {
    package: "@shepherdjerred/delivery",
    reportDirectory: "shepherdjerred__delivery",
  },
  {
    package: "@shepherdjerred/tracker",
    reportDirectory: "shepherdjerred__tracker",
  },
  {
    package: "@shepherdjerred/tasknotes-web",
    reportDirectory: "shepherdjerred__tasknotes-web",
  },
  {
    package: "@shepherdjerred/artifacts",
    reportDirectory: "shepherdjerred__artifacts",
  },
  { package: "sjer.red", reportDirectory: "sjer.red" },
  {
    package: "@shepherdjerred/docs-wiki",
    reportDirectory: "shepherdjerred__docs-wiki",
  },
  {
    package: "@shepherdjerred/alert-dashboard",
    reportDirectory: "shepherdjerred__alert-dashboard",
  },
  {
    package: "@shepherdjerred/media",
    reportDirectory: "shepherdjerred__media",
  },
  {
    package: "@scout-for-lol/app",
    reportDirectory: "scout-for-lol__app",
  },
  {
    package: "@scout-for-lol/design-system",
    reportDirectory: "scout-for-lol__design-system",
  },
  {
    package: "@shepherdjerred/console-ui",
    reportDirectory: "shepherdjerred__console-ui",
    task: "test:browser",
  },
] as const;

const ALL_TARGET_INPUTS = [
  // Site consumers use the same global inputs. A generator or handoff change
  // must select their tested artifact producers before deploy requests them.
  ...globalPaths,
  "ci/ci-playwright/",
  "packages/woodpecker-config-extension/src/pipeline/lanes/playwright.ts",
  "ci/scripts/bun-install.sh",
  "ci/scripts/selectors/select-image-targets-lockfile.ts",
  "ci/scripts/selection/playwright-partition.ts",
  "ci/scripts/selection/playwright-targets.ts",
  "ci/scripts/selection/run-playwright.ts",
  "ci/scripts/selectors/select-image-targets-workspaces.ts",
  "ci/scripts/toolchain.sh",
  ".mise.toml",
  "mise.lock",
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "scripts/ci-test-manifest.json",
  "patches/",
  "scripts/ci/ci-reporting.ts",
  "scripts/ci/test-manifest-schema.ts",
  "scripts/ci/namespace-playwright-reports.ts",
  "scripts/ci/write-ci-report-index.ts",
  "scripts/lib/json.ts",
  "turbo.json",
] as const;

const SCOUT_TARGET_INPUTS = [
  "packages/scout-for-lol/eslint.config.ts",
  "packages/scout-for-lol/package.json",
  "packages/scout-for-lol/scripts/dev/dev-web.ts",
  "packages/scout-for-lol/tsconfig.base.json",
] as const;

const SITE_ARTIFACT_INPUTS = [
  "config/analytics-sites.json",
  "scripts/release/deploy-site.ts",
  "scripts/lib/run.ts",
  "scripts/lib/s3-static-site.ts",
] as const;
const SJER_RED_INPUTS = [
  "scripts/checks/check-built-internal-links.ts",
] as const;

const SCOUT_TARGETS = new Set([
  "@scout-for-lol/app",
  "@scout-for-lol/design-system",
]);
const SITE_ARTIFACT_TARGETS = new Set([
  "sjer.red",
  "@shepherdjerred/docs-wiki",
]);

// Browser acceptance can start a service that the shipped client does not
// import. Scout generation also has an edge to Birmel's Prisma setup.
const SYNTHETIC_WORKSPACE_DEPENDENCIES: Readonly<
  Record<string, readonly string[]>
> = {
  "@scout-for-lol/app": ["@shepherdjerred/birmel"],
  "@shepherdjerred/tasknotes-web": ["tasknotes-server"],
};

export type PlaywrightSelection = {
  readonly mode: "selected" | "all";
  readonly globalReason: string | null;
  readonly targets: readonly PlaywrightTarget[];
  readonly reasons: Readonly<Record<string, readonly string[]>>;
};

function matches(path: string, input: string): boolean {
  return (
    path === input || path.startsWith(input.endsWith("/") ? input : `${input}/`)
  );
}

function matchingInput(
  path: string,
  inputs: readonly string[],
): string | undefined {
  return inputs.find((input) => matches(path, input));
}

export function allPlaywrightTargets(reason: string): PlaywrightSelection {
  return {
    mode: "all",
    globalReason: reason,
    targets: PLAYWRIGHT_TARGETS,
    reasons: Object.fromEntries(
      PLAYWRIGHT_TARGETS.map((target) => [target.package, [reason]]),
    ),
  };
}

function addReason(
  reasons: Map<string, string[]>,
  target: string,
  reason: string,
): void {
  const current = reasons.get(target);
  if (current === undefined) {
    reasons.set(target, [reason]);
  } else if (!current.includes(reason)) {
    current.push(reason);
  }
}

function addWorkspaceClosureReasons(
  target: PlaywrightTarget,
  changedPaths: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
  reasons: Map<string, string[]>,
): void {
  const closure = dependencyClosure(target.package, packages);
  for (const dependency of SYNTHETIC_WORKSPACE_DEPENDENCIES[target.package] ??
    []) {
    closure.add(dependency);
  }
  for (const dependency of closure) {
    const workspace = packages.get(dependency);
    if (workspace === undefined) {
      throw new Error(
        `workspace disappeared while selecting ${target.package}`,
      );
    }
    for (const changedPath of changedPaths) {
      if (!changedPath.startsWith(workspace.dir)) continue;
      addReason(
        reasons,
        target.package,
        `workspace closure: ${changedPath} under ${workspace.dir}`,
      );
    }
  }
}

export function additionalPlaywrightInstallFilters(
  selectedPackages: readonly string[],
): readonly string[] {
  return [
    ...new Set(
      selectedPackages.flatMap(
        (packageName) => SYNTHETIC_WORKSPACE_DEPENDENCIES[packageName] ?? [],
      ),
    ),
  ];
}

function addConfiguredInputReasons(options: {
  readonly target: PlaywrightTarget;
  readonly changedPaths: readonly string[];
  readonly targetPackages: ReadonlySet<string>;
  readonly inputs: readonly string[];
  readonly label: string;
  readonly reasons: Map<string, string[]>;
}): void {
  if (!options.targetPackages.has(options.target.package)) return;
  for (const changedPath of options.changedPaths) {
    const input = matchingInput(changedPath, options.inputs);
    if (input === undefined) continue;
    addReason(
      options.reasons,
      options.target.package,
      `${options.label}: ${changedPath} (matches ${input})`,
    );
  }
}

export async function selectPlaywrightTargets(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
  workspacePackages?: ReadonlyMap<string, WorkspacePackage>,
): Promise<PlaywrightSelection> {
  for (const path of changedPaths) {
    const input = matchingInput(path, ALL_TARGET_INPUTS);
    if (input !== undefined) {
      return allPlaywrightTargets(
        `global browser input changed: ${path} (matches ${input})`,
      );
    }
  }

  const packages = workspacePackages ?? (await loadWorkspaces(repoRoot));
  const reasons = new Map<string, string[]>();
  for (const target of PLAYWRIGHT_TARGETS) {
    addWorkspaceClosureReasons(target, changedPaths, packages, reasons);
    addConfiguredInputReasons({
      target,
      changedPaths,
      targetPackages: SCOUT_TARGETS,
      inputs: SCOUT_TARGET_INPUTS,
      label: "shared Scout input",
      reasons,
    });
    addConfiguredInputReasons({
      target,
      changedPaths,
      targetPackages: SITE_ARTIFACT_TARGETS,
      inputs: SITE_ARTIFACT_INPUTS,
      label: "site artifact input",
      reasons,
    });
    addConfiguredInputReasons({
      target,
      changedPaths,
      targetPackages: new Set(["sjer.red"]),
      inputs: SJER_RED_INPUTS,
      label: "sjer.red build input",
      reasons,
    });
  }

  const targets = PLAYWRIGHT_TARGETS.filter((target) =>
    reasons.has(target.package),
  );
  return {
    mode: "selected",
    globalReason: null,
    targets,
    reasons: Object.fromEntries(reasons),
  };
}
