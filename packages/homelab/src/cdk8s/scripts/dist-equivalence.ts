/**
 * Whole-`dist/` equivalence harness for cdk8s refactors.
 *
 * Builds the rendered manifests at a base ref (default `origin/main`) in a
 * throwaway detached worktree and at the current checkout, then diffs the two
 * `dist/` trees. A refactor PR must produce no difference; a behavior-change
 * PR names the files it means to change with `--allow` and every other file
 * must still be identical.
 *
 *   bun run check:dist-equivalence
 *   bun run check:dist-equivalence -- --base origin/main --allow syncthing.k8s.yaml
 *
 * Exit codes: 0 identical (outside `--allow`), 1 differences, 2 usage or
 * build failure.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PACKAGE_PATH = "packages/homelab/src/cdk8s";
const repositoryRoot = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);

type CommandResult = { exitCode: number; stdout: string };

async function run(
  command: readonly string[],
  cwd: string,
  capture = false,
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd,
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    capture ? new Response(child.stdout).text() : Promise.resolve(""),
    child.exited,
  ]);
  return { exitCode, stdout };
}

async function mustRun(command: readonly string[], cwd: string): Promise<void> {
  const { exitCode } = await run(command, cwd);
  if (exitCode !== 0)
    throw new Error(
      `${command.join(" ")} failed with exit ${String(exitCode)} in ${cwd}`,
    );
}

/** The synthesized tree exactly as `bun run build` publishes it. */
async function buildDist(root: string): Promise<string> {
  await mustRun(
    ["bunx", "turbo", "run", "build", "--filter=@homelab/cdk8s"],
    root,
  );
  return path.join(root, PACKAGE_PATH, "dist");
}

/**
 * Names of the top-level `dist/` entries that differ, from `diff -rq`.
 * Exported for the unit test.
 */
export function changedEntries(
  briefDiff: string,
  baseDist: string,
  headDist: string,
): string[] {
  const entries = new Set<string>();
  for (const line of briefDiff.split("\n")) {
    const differing = /^Files (.+) and .+ differ$/u.exec(line);
    const only = /^Only in (.+): (.+)$/u.exec(line);
    let file: string | undefined;
    if (differing?.[1] !== undefined) file = differing[1];
    else if (only?.[1] !== undefined && only[2] !== undefined)
      file = path.join(only[1], only[2]);
    if (file === undefined) continue;
    const root = file.startsWith(`${headDist}${path.sep}`)
      ? headDist
      : baseDist;
    const top = path.relative(root, file).split(path.sep)[0];
    if (top !== undefined && top !== "") entries.add(top);
  }
  return [...entries].sort();
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      base: { type: "string", default: "origin/main" },
      allow: { type: "string", multiple: true, default: [] },
    },
  });
  const allowed = new Set(values.allow);

  const baseRoot = await mkdtemp(path.join(tmpdir(), "cdk8s-dist-base-"));
  try {
    await mustRun(
      ["git", "worktree", "add", "--detach", baseRoot, values.base],
      repositoryRoot,
    );
    await mustRun(["bun", "install", "--frozen-lockfile"], baseRoot);
    const baseDist = await buildDist(baseRoot);
    const headDist = await buildDist(repositoryRoot);

    const brief = await run(
      ["diff", "-rq", baseDist, headDist],
      repositoryRoot,
      true,
    );
    if (brief.exitCode > 1) throw new Error("diff failed");
    const changed = changedEntries(brief.stdout, baseDist, headDist);
    const unexpected = changed.filter((entry) => !allowed.has(entry));
    const unchangedAllowances = [...allowed].filter(
      (entry) => !changed.includes(entry),
    );

    if (changed.length > 0)
      await run(["diff", "-ru", baseDist, headDist], repositoryRoot);

    if (unexpected.length > 0) {
      console.error(
        `\ndist/ differs from ${values.base} in: ${unexpected.join(", ")}`,
      );
      return 1;
    }
    if (unchangedAllowances.length > 0) {
      console.error(
        `\n--allow names files that did not change: ${unchangedAllowances.join(", ")}`,
      );
      return 1;
    }
    console.log(
      changed.length === 0
        ? `dist/ is identical to ${values.base}`
        : `dist/ differs from ${values.base} only in the allowed files: ${changed.join(", ")}`,
    );
    return 0;
  } finally {
    await run(
      ["git", "worktree", "remove", "--force", baseRoot],
      repositoryRoot,
    );
    await rm(baseRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
