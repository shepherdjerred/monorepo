import { afterEach, expect, test } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scannerSteps } from "#src/pipeline/lanes/scanners.ts";
import { TEST_IMAGES } from "#test-identity";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

const env = {
  PATH: Bun.env["PATH"],
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "CI fixture",
  GIT_AUTHOR_EMAIL: "ci@example.invalid",
  GIT_COMMITTER_NAME: "CI fixture",
  GIT_COMMITTER_EMAIL: "ci@example.invalid",
};

function git(args: string[], cwd: string) {
  const child = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...env, HOME: cwd },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stdout: new TextDecoder().decode(child.stdout).trim(),
    stderr: new TextDecoder().decode(child.stderr),
  };
}

function mustGit(args: string[], cwd: string) {
  const result = git(args, cwd);
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else {
      const info = await stat(entryPath);
      total += info.size;
    }
  }
  return total;
}

/** The semgrep step's history fetches and merge-base, up to the scan itself. */
function historyScript(): string {
  const semgrep = scannerSteps(TEST_IMAGES).find(
    (step) => step.key === "semgrep",
  );
  if (semgrep === undefined) throw new Error("semgrep step missing");
  const start = semgrep.commands.findIndex((command) =>
    command.includes("git fetch"),
  );
  const end = semgrep.commands.indexOf("set +e");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return [
    ...semgrep.commands.slice(start, end),
    String.raw`printf "%s\n" "$base"`,
  ].join("\n");
}

test("semgrep's history fetch leaves a golden-clone workspace a complete repository and rewrites nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scanner-fetch-"));
  roots.push(root);
  const origin = path.join(root, "origin");
  mustGit(["init", "--quiet", "--initial-branch=main", origin], root);
  // The old form asked for a filter; allow it so a regression reaches the
  // pack rewrite instead of failing on the transport.
  mustGit(["config", "uploadpack.allowFilter", "true"], origin);
  mustGit(["config", "uploadpack.allowAnySHA1InWant", "true"], origin);
  const commit = async (name: string) => {
    await writeFile(
      path.join(origin, "payload.bin"),
      crypto.getRandomValues(new Uint8Array(512 * 1024)),
    );
    await writeFile(path.join(origin, `${name}.txt`), name);
    mustGit(["add", "-A"], origin);
    mustGit(["commit", "-m", name], origin);
    return mustGit(["rev-parse", "HEAD"], origin);
  };
  for (let index = 0; index < 8; index++)
    await commit(`old-${index.toString()}`);
  const golden = await commit("golden");
  // A pull request branches from main, which then moves two commits past it.
  mustGit(["checkout", "-b", "feature"], origin);
  const head = await commit("feature");
  mustGit(["checkout", "main"], origin);
  await commit("main-1");
  await commit("main-2");

  // The golden clone: the golden commit's history, then the checkout's
  // depth-one fetch of the pull request head leaves it behind a shallow
  // boundary but in the object store.
  const workspace = path.join(root, "workspace");
  const url = pathToFileURL(origin).href;
  mustGit(["init", "--quiet", workspace], root);
  mustGit(["remote", "add", "origin", url], workspace);
  mustGit(
    ["fetch", "--no-tags", "--no-filter", "origin", `+${golden}:`],
    workspace,
  );
  mustGit(["reset", "--hard", "--quiet", golden], workspace);
  mustGit(
    ["fetch", "--no-tags", "--depth=1", "--no-filter", "origin", `+${head}:`],
    workspace,
  );
  mustGit(["reset", "--hard", "--quiet", head], workspace);
  const before = await directoryBytes(path.join(workspace, ".git", "objects"));

  const child = Bun.spawnSync(
    ["bash", "-euo", "pipefail", "-c", historyScript()],
    {
      cwd: workspace,
      env: { ...env, HOME: workspace },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (child.exitCode !== 0)
    throw new Error(new TextDecoder().decode(child.stderr));
  const base = new TextDecoder().decode(child.stdout).trim().split("\n").at(-1);
  // The merge base is the golden commit, found the same way as before.
  expect(base).toBe(golden);

  // Not a partial clone: Git would otherwise rewrite every local object into a
  // new promisor pack.
  expect(
    git(["config", "--get", "remote.origin.promisor"], workspace).exitCode,
  ).toBe(1);
  expect(
    git(["config", "--get", "extensions.partialclone"], workspace).exitCode,
  ).toBe(1);
  // Only the two new main commits (about 1 MiB) were written, not the history
  // already held (about 4.5 MiB), which a rewrite would add again.
  const grown =
    (await directoryBytes(path.join(workspace, ".git", "objects"))) - before;
  expect(grown).toBeLessThan(before / 2);
  mustGit(["fsck", "--connectivity-only", "--no-dangling"], workspace);
}, 60_000);
