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
import type { IncidentDetail } from "@shepherdjerred/incidents/contract";
import {
  commanderMessage,
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

const REQUEST: SpawnRequest = {
  message: "toolkit incident claim INC-7 --dispatch-handle handle-000000000001",
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

  await expect(processSpawner(file)(REQUEST)).resolves.toEqual({
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

test("a failing spawner reports its last line", async () => {
  const { file } = await script(
    `echo "starting" >&2\necho "could not open space" >&2\nexit 3`,
  );

  const outcome = await processSpawner(file)(REQUEST);

  expect(outcome).toEqual({
    ok: false,
    error: "spawner.sh exited 3: could not open space",
  });
});

test("a missing or hung spawner is a failed spawn, not a crash", async () => {
  const missing = await processSpawner("/nonexistent/herdr-new-worktree")(
    REQUEST,
  );
  expect(missing.ok).toBe(false);

  const { file } = await script("sleep 30");
  const hung = await processSpawner(file, { timeoutMs: 200 })(REQUEST);
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

const INCIDENT = {
  id: "00000000-0000-4000-8000-000000000007",
  number: 7,
  identifier: "INC-7",
  kind: "incident",
  title: "Storage is read-only",
  severity: "sev2",
  status: "investigating",
  systems: ["storage"],
  components: [],
  source: "manual",
  command: {
    state: "dispatching",
    commander: null,
    dispatcher: null,
    leaseExpiresAt: "2026-11-26T12:10:00.000Z",
    takeoverEligibleAt: "2026-11-26T12:00:00.000Z",
  },
  affectedCount: 0,
  firingSignals: 0,
  declaredAt: "2026-11-26T11:50:00.000Z",
  updatedAt: "2026-11-26T12:00:00.000Z",
  resolvedAt: null,
  scheduledStart: null,
  scheduledEnd: null,
  revision: 3,
  url: "https://hub.example.ts.net/incidents/INC-7",
  summary: "",
  impact: null,
  exitCondition: "Writes succeed again.",
  suspect: null,
  creator: null,
  resolutionNote: null,
  mitigatedAt: null,
  affected: [],
  links: [],
  signals: [],
  timeline: [],
} satisfies IncidentDetail;
const LEASE = {
  handle: "handle-000000000001",
  leaseExpiresAt: "2026-11-26T12:10:00.000Z",
};

test("the first message carries the handle, and --hub-url only for a non-default Hub", () => {
  const local = commanderMessage(INCIDENT, LEASE, null);
  expect(local).toContain(
    "toolkit incident claim INC-7 --dispatch-handle handle-000000000001\n",
  );
  expect(local).not.toContain("--hub-url");

  const remote = commanderMessage(INCIDENT, LEASE, "http://127.0.0.1:7400");
  for (const command of [
    "claim INC-7 --dispatch-handle handle-000000000001",
    "update INC-7",
    "view INC-7",
    "resolve INC-7",
  ])
    expect(remote).toMatch(
      new RegExp(
        String.raw`toolkit incident ${command} --hub-url http://127\.0\.0\.1:7400`,
        "u",
      ),
    );
});
