import path from "node:path";
import { z } from "zod";
import type { Churn, TaskGraph } from "./report.ts";

const DryRunSchema = z
  .object({
    globalCacheInputs: z
      .object({ files: z.record(z.string(), z.string()) })
      .loose(),
    tasks: z.array(
      z
        .object({
          taskId: z.string().min(1),
          directory: z.string(),
          inputs: z.record(z.string(), z.string()),
          dependents: z.array(z.string()),
          command: z.string(),
          /** Turbo's hash of the lockfile entries this task's package depends on. */
          hashOfExternalDependencies: z.string().min(1),
        })
        .loose(),
    ),
  })
  .loose();

/**
 * The only file besides `globalCacheInputs.files` that always reaches every
 * task: the root turbo.json configures every task's hash. Turbo hashes the
 * lockfile per package through `hashOfExternalDependencies`, so it is not
 * global. The root package.json is an input of the root `//#` tasks, but its
 * dependency fields also feed `globalCacheInputs.hashOfExternalDependencies`,
 * so an edit to them reaches every task; see `rootDependencyEdits`.
 */
const GLOBAL_CONFIG = ["turbo.json"];
const LOCKFILE = "bun.lock";

/** The task graph from `turbo run ... --dry=json`, with repository paths. */
export function taskGraphFromDryRun(raw: unknown): TaskGraph {
  const dryRun = DryRunSchema.parse(raw);
  return {
    inputs: new Map(
      dryRun.tasks.map((task) => [
        task.taskId,
        Object.keys(task.inputs).map((file) =>
          path.posix.normalize(path.posix.join(task.directory, file)),
        ),
      ]),
    ),
    dependents: new Map(
      dryRun.tasks.map((task) => [task.taskId, task.dependents]),
    ),
    // A task without a package script runs nothing; it only links hashes.
    transit: new Set(
      dryRun.tasks
        .filter((task) => task.command === "<NONEXISTENT>")
        .map((task) => task.taskId),
    ),
    globalFiles: [
      ...new Set([
        ...GLOBAL_CONFIG,
        ...Object.keys(dryRun.globalCacheInputs.files),
      ]),
    ],
    lockfile: LOCKFILE,
    externalDependencyGroups: new Map(
      [
        ...Map.groupBy(dryRun.tasks, (task) => task.hashOfExternalDependencies),
      ].map(([hash, tasks]) => [hash, tasks.map((task) => task.taskId)]),
    ),
  };
}

/** Commits per file on a ref, from `git log --name-only` output. */
export function commitsPerFile(gitLog: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of gitLog.split("\n")) {
    const file = line.trim();
    if (file === "") continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

async function output(
  command: readonly string[],
  cwd: string,
  what: string,
): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`${what} exited ${String(exitCode)}: ${stderr.trim()}`);
  return stdout;
}

/** The repository the analysis reads its task graph and churn from. */
export async function repositoryTopLevel(): Promise<string> {
  const root = await output(
    ["git", "rev-parse", "--show-toplevel"],
    process.cwd(),
    "git rev-parse",
  );
  return root.trim();
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
  "catalog",
  "catalogs",
  "patchedDependencies",
  "trustedDependencies",
] as const;

/** The parts of a root package.json that Turbo's external-dependency hash reads. */
function dependencyView(manifest: string): string {
  const parsed = z
    .object({ workspaces: z.unknown().optional() })
    .loose()
    .parse(JSON.parse(manifest));
  const fields: Record<string, unknown> = {};
  for (const field of DEPENDENCY_FIELDS) fields[field] = parsed[field];
  // Bun keeps catalogs under `workspaces`; the workspace globs themselves only
  // add packages, which changes their hashes and not the global one.
  const workspaces = z
    .object({
      catalog: z.unknown().optional(),
      catalogs: z.unknown().optional(),
    })
    .loose()
    .safeParse(parsed.workspaces);
  if (workspaces.success) {
    fields["workspaces.catalog"] = workspaces.data.catalog;
    fields["workspaces.catalogs"] = workspaces.data.catalogs;
  }
  return JSON.stringify(fields);
}

/** Whether a root package.json edit changed any dependency field. */
export function dependencyFieldsChanged(
  before: string,
  after: string,
): boolean {
  return dependencyView(before) !== dependencyView(after);
}

/** Commits in the window that changed the root package.json's dependency fields. */
async function rootDependencyEdits(
  repositoryRoot: string,
  churnDays: number,
  ref: string,
): Promise<number> {
  const log = await output(
    [
      "git",
      "log",
      `--since=${String(churnDays)}.days`,
      "--format=%H",
      ref,
      "--",
      "package.json",
    ],
    repositoryRoot,
    "git log package.json",
  );
  const commits = log.split("\n").filter((line) => line.trim() !== "");
  const changed = await Promise.all(
    commits.map(async (commit) => {
      const [before, after] = await Promise.all([
        output(
          ["git", "show", `${commit}^:package.json`],
          repositoryRoot,
          "git show parent package.json",
        ),
        output(
          ["git", "show", `${commit}:package.json`],
          repositoryRoot,
          "git show package.json",
        ),
      ]);
      return dependencyFieldsChanged(before, after);
    }),
  );
  return changed.filter(Boolean).length;
}

/** Verify's task graph and per-file churn from the local checkout. */
export async function collectHotFileInputs(
  repositoryRoot: string,
  churnDays: number,
  ref: string,
): Promise<{ graph: TaskGraph; churn: Churn }> {
  const tasks = z
    .array(z.string().min(1))
    .min(1)
    .parse(
      JSON.parse(
        await output(
          ["bun", "--no-install", "scripts/verify.ts", "--list-tasks"],
          repositoryRoot,
          "scripts/verify.ts --list-tasks",
        ),
      ),
    );
  const [dryRun, gitLog, dependencyEdits] = await Promise.all([
    output(
      ["bun", "x", "--no-install", "turbo", "run", ...tasks, "--dry=json"],
      repositoryRoot,
      "turbo run --dry=json",
    ),
    output(
      [
        "git",
        "log",
        `--since=${String(churnDays)}.days`,
        "--no-renames",
        "--format=",
        "--name-only",
        ref,
      ],
      repositoryRoot,
      "git log",
    ),
    rootDependencyEdits(repositoryRoot, churnDays, ref),
  ]);
  return {
    graph: taskGraphFromDryRun(JSON.parse(dryRun)),
    churn: {
      commits: commitsPerFile(gitLog),
      rootDependencyEdits: dependencyEdits,
    },
  };
}
