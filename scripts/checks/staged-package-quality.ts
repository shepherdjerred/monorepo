/**
 * Pre-commit typecheck and lint for the workspace packages that own staged
 * files. Package-scoped (a TS program is a package), not file-scoped; Turbo
 * cache makes repeats cheap. Concurrency is 1 so parallel worktrees do not
 * each spawn a laptop-sized `tsc` storm. Tests, dependents, and `verify`
 * stay out — those are still focused Turbo / Buildkite.
 */
import path from "node:path";
import { z } from "zod";

import { run } from "../lib/run.ts";

const QUALITY_TASKS = ["typecheck", "lint"] as const;
const QUALITY_PATH = /\.(?:[cm]?[jt]sx?|jsonc?|astro)$/u;
const ADDITIONAL_OWNERS: readonly {
  prefix: string;
  workspaceDirectory: string;
}[] = [
  { prefix: ".buildkite/scripts/", workspaceDirectory: "scripts" },
  {
    prefix: ".buildkite/eslint-suppressions.json",
    workspaceDirectory: "scripts",
  },
  {
    prefix: ".buildkite/tsconfig.json",
    workspaceDirectory: "scripts",
  },
];

const RootPackageSchema = z.looseObject({
  workspaces: z.array(z.string().min(1)),
});
const WorkspaceManifestSchema = z.looseObject({
  name: z.string().min(1),
  scripts: z.record(z.string(), z.string()).optional(),
});

export type WorkspacePackage = {
  name: string;
  directory: string;
  scripts: ReadonlySet<string>;
};

const defaultRoot = path.resolve(import.meta.dir, "../..");

export function toRepoRelative(input: string, repositoryRoot: string): string {
  const absolute = path.isAbsolute(input)
    ? input
    : path.resolve(repositoryRoot, input);
  const relative = path.relative(repositoryRoot, absolute);
  if (relative === "") {
    return "";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`staged path is outside the repository: ${input}`);
  }
  return relative.split(path.sep).join("/");
}

export function isQualityPath(filePath: string): boolean {
  if (!QUALITY_PATH.test(filePath)) {
    return false;
  }
  if (filePath === "sandbox" || filePath.startsWith("sandbox/")) {
    return false;
  }
  const segments = new Set(filePath.split("/"));
  return !segments.has("generated") && !segments.has("node_modules");
}

function isInsideWorkspace(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

function hasQualityTask(workspace: WorkspacePackage): boolean {
  return QUALITY_TASKS.some((task) => workspace.scripts.has(task));
}

export function packagesForStagedPaths(
  paths: readonly string[],
  workspaces: readonly WorkspacePackage[],
): string[] {
  const byDirectory = new Map(
    workspaces.map((workspace) => [workspace.directory, workspace]),
  );
  const longestFirst = [...workspaces].sort(
    (left, right) => right.directory.length - left.directory.length,
  );
  const names = new Set<string>();
  for (const filePath of paths) {
    if (!isQualityPath(filePath)) {
      continue;
    }
    const matched = longestFirst.find((workspace) =>
      isInsideWorkspace(filePath, workspace.directory),
    );
    const extra = ADDITIONAL_OWNERS.find((owner) =>
      filePath.startsWith(owner.prefix),
    );
    const workspace =
      matched ??
      (extra === undefined
        ? undefined
        : byDirectory.get(extra.workspaceDirectory));
    if (workspace === undefined || !hasQualityTask(workspace)) {
      continue;
    }
    names.add(workspace.name);
  }
  return [...names].sort();
}

export function turboQualityCommand(packages: readonly string[]): string[] {
  return [
    "bunx",
    "--no-install",
    "turbo",
    "run",
    ...QUALITY_TASKS,
    ...packages.flatMap((name) => [`--filter=${name}`]),
    "--concurrency=1",
    "--output-logs=errors-only",
  ];
}

export async function loadWorkspaces(
  repositoryRoot: string,
): Promise<WorkspacePackage[]> {
  const rootManifest = RootPackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  );
  const workspaces: WorkspacePackage[] = [];
  for (const directory of rootManifest.workspaces) {
    const manifest = WorkspaceManifestSchema.parse(
      await Bun.file(
        path.join(repositoryRoot, directory, "package.json"),
      ).json(),
    );
    workspaces.push({
      name: manifest.name,
      directory: directory.split(path.sep).join("/"),
      scripts: new Set(Object.keys(manifest.scripts ?? {})),
    });
  }
  return workspaces;
}

export async function runStagedPackageQuality(
  paths: readonly string[],
  options: {
    repositoryRoot?: string;
    workspaces?: readonly WorkspacePackage[];
    runCommand?: (command: readonly string[]) => Promise<void>;
  } = {},
): Promise<"skipped" | "ran"> {
  const repositoryRoot = options.repositoryRoot ?? defaultRoot;
  const workspaces =
    options.workspaces ?? (await loadWorkspaces(repositoryRoot));
  const relativePaths = paths.map((filePath) =>
    toRepoRelative(filePath, repositoryRoot),
  );
  const packages = packagesForStagedPaths(relativePaths, workspaces);
  if (packages.length === 0) {
    console.log("package-quality: no workspace packages for staged files");
    return "skipped";
  }
  const command = turboQualityCommand(packages);
  console.log(`package-quality: ${packages.join(", ")}`);
  const runCommand =
    options.runCommand ??
    (async (commandToRun) => {
      await run([...commandToRun]);
    });
  await runCommand(command);
  return "ran";
}

if (import.meta.main) {
  await runStagedPackageQuality(Bun.argv.slice(2));
}
