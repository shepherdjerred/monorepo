import path from "node:path";
import { z } from "zod";
import type { TaskGraph } from "./report.ts";

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
        })
        .loose(),
    ),
  })
  .loose();

/**
 * Turbo hashes these into every task without listing them as inputs. The
 * lockfile only reaches packages whose dependency closure changed, so treating
 * it as global is an upper bound.
 */
const ALWAYS_HASHED = ["package.json", "turbo.json", "bun.lock"];

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
        ...ALWAYS_HASHED,
        ...Object.keys(dryRun.globalCacheInputs.files),
      ]),
    ],
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

/** Verify's task graph and per-file churn from the local checkout. */
export async function collectHotFileInputs(
  repositoryRoot: string,
  churnDays: number,
  ref: string,
): Promise<{ graph: TaskGraph; commits: Map<string, number> }> {
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
  const [dryRun, gitLog] = await Promise.all([
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
  ]);
  return {
    graph: taskGraphFromDryRun(JSON.parse(dryRun)),
    commits: commitsPerFile(gitLog),
  };
}
