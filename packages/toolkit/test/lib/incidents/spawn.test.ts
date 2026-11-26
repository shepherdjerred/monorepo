import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  processSpawner,
  repoLocation,
  type SpawnRequest,
} from "#lib/incidents/spawn.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "incident-spawn-")),
  );
  directories.push(directory);
  return directory;
}

const TOKEN = "t".repeat(24);
const REQUEST: SpawnRequest = {
  message: `toolkit incident claim INC-7 --dispatch-token ${TOKEN}`,
  provider: "claude-code",
  machine: null,
  repoMain: "/repo",
  repoTop: "/repo",
  root: "/home/a/.herdr/worktrees/repo",
  agentArgs: [],
  safe: false,
  launcher: "brim",
  argv: null,
  tab: "INC-7 commander",
  sendMessage: true,
};

async function script(body: string): Promise<{ file: string; dir: string }> {
  const dir = await tempDir();
  const file = path.join(dir, "spawner.sh");
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return { file, dir };
}

test("the spawner gets --request-env and the request in HERDR_WORKTREE_REQUEST, not argv", async () => {
  const { file, dir } = await script(
    `printf '%s' "$*" > "$(dirname "$0")/argv"\nprintf '%s' "$HERDR_WORKTREE_REQUEST" > "$(dirname "$0")/request"`,
  );

  await expect(processSpawner(file)(REQUEST, TOKEN)).resolves.toEqual({
    ok: true,
  });

  await expect(readFile(path.join(dir, "argv"), "utf8")).resolves.toBe(
    "--request-env",
  );
  const sent: unknown = JSON.parse(
    await readFile(path.join(dir, "request"), "utf8"),
  );
  expect(sent).toEqual(REQUEST);
});

test("a failing spawner reports its last line with the token redacted", async () => {
  const { file } = await script(
    `echo "starting" >&2\necho "could not open space for ${TOKEN}" >&2\nexit 3`,
  );

  const outcome = await processSpawner(file)(REQUEST, TOKEN);

  expect(outcome).toEqual({
    ok: false,
    error: "spawner.sh exited 3: could not open space for [redacted]",
  });
});

test("a missing or hung spawner is a failed spawn, not a crash", async () => {
  const missing = await processSpawner("/nonexistent/herdr-new-worktree")(
    REQUEST,
    TOKEN,
  );
  expect(missing.ok).toBe(false);

  const { file } = await script("sleep 30");
  const hung = await processSpawner(file, { timeoutMs: 200 })(REQUEST, TOKEN);
  expect(hung.ok).toBe(false);
});

test("repo location follows the Herdr dialog: main checkout and ~/.herdr/worktrees/<repo>", async () => {
  const repo = await tempDir();
  Bun.spawnSync(["git", "init", "-q", repo]);

  expect(repoLocation(repo, "/home/agent")).toEqual({
    repoMain: repo,
    repoTop: repo,
    root: path.join("/home/agent/.herdr/worktrees", path.basename(repo)),
  });
});
