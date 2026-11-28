import { afterEach, expect, test } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureAncestor } from "./ensure-ancestor.ts";

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

test("deepening a depth-one checkout does not rewrite the objects it already holds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ensure-ancestor-"));
  roots.push(root);
  const origin = path.join(root, "origin");
  mustGit(["init", "--quiet", "--initial-branch=main", origin], root);
  // Filtered fetches are what the old implementation used; allow them so a
  // regression reaches the rewrite rather than failing on the transport.
  mustGit(["config", "uploadpack.allowFilter", "true"], origin);
  mustGit(["config", "uploadpack.allowAnySHA1InWant", "true"], origin);
  let base = "";
  let golden = "";
  for (let index = 0; index < 6; index++) {
    await writeFile(
      path.join(origin, "payload.bin"),
      crypto.getRandomValues(new Uint8Array(512 * 1024)),
    );
    await writeFile(path.join(origin, `${index.toString()}.txt`), "x");
    mustGit(["add", "-A"], origin);
    mustGit(["commit", "-m", index.toString()], origin);
    if (index === 2) base = mustGit(["rev-parse", "HEAD"], origin);
    if (index === 3) golden = mustGit(["rev-parse", "HEAD"], origin);
  }
  const head = mustGit(["rev-parse", "HEAD"], origin);

  // The golden holds the history up to its commit; the checkout then moves to
  // the pull request head with a depth-one fetch, leaving that history behind
  // a shallow boundary but in the object store.
  const workspace = path.join(root, "workspace");
  mustGit(["init", "--quiet", workspace], root);
  mustGit(["remote", "add", "origin", pathToFileURL(origin).href], workspace);
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

  const valid = await ensureAncestor(
    base,
    "HEAD",
    (command) => Promise.resolve(git(command.slice(1), workspace)),
    true,
  );
  expect(valid).toBe(true);
  const grown =
    (await directoryBytes(path.join(workspace, ".git", "objects"))) - before;
  // Only the commits between the golden and the head are new: one payload of
  // about 0.5 MiB. A filtered fetch would instead rewrite everything already
  // held (about 2 MiB) into a new pack.
  expect(grown).toBeLessThan(before / 2);
  expect(
    git(["config", "--get", "remote.origin.promisor"], workspace).exitCode,
  ).toBe(1);
  expect(
    git(["config", "--get", "extensions.partialclone"], workspace).exitCode,
  ).toBe(1);
}, 60_000);
