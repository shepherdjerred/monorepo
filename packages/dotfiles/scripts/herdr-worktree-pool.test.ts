import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  startDetachedToolkit,
  type Toolkit,
} from "../bin/herdr_new_worktree_core.ts";
import { allocate, replenish } from "../bin/herdr_worktree_pool_core.ts";
import type { Launchd } from "../bin/herdr_worktree_pool_launchd.ts";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(error.trim());
  return out.trim();
}

async function fixture() {
  const tmp = await mkdtemp(path.join(tmpdir(), "herdr-pool-"));
  const repo = path.join(tmp, "repo");
  const remote = path.join(tmp, "origin");
  const root = path.join(tmp, "worktrees", "repo");
  await git(tmp, "init", "--initial-branch=main", repo);
  await git(tmp, "init", "--bare", "--initial-branch=main", remote);
  await git(repo, "config", "user.email", "herdr@example.invalid");
  await git(repo, "config", "user.name", "Herdr Test");
  await git(repo, "config", "core.hooksPath", path.join(tmp, "no-hooks"));
  await git(repo, "config", "commit.gpgsign", "false");
  await writeFile(path.join(repo, "file"), "first\n");
  await git(repo, "add", "file");
  await git(repo, "commit", "-m", "First");
  await git(repo, "remote", "add", "origin", remote);
  await git(repo, "push", "origin", "main");
  return { repo, root, tmp, remote };
}

async function registered(repo: string) {
  const list = await git(repo, "worktree", "list", "--porcelain", "-z");
  return list
    .split("\0")
    .flatMap((entry) =>
      entry.startsWith("worktree ") ? [entry.slice(9)] : [],
    );
}

async function stagesOf(repo: string): Promise<string[]> {
  const all = await registered(repo);
  return all.filter((entry) => entry.includes("/.pool/"));
}

test("parallel claims move distinct prepared worktrees and use the fetched main tip", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    const previous = await git(repo, "rev-parse", "HEAD");
    expect(await replenish(setup, true)).toBe(3);
    const stages = await stagesOf(repo);
    const stageIds = await Promise.all(
      stages.map((stage) => git(stage, "rev-parse", "--absolute-git-dir")),
    );
    expect(stageIds).toHaveLength(3);
    expect(await git(repo, "worktree", "list", "--porcelain")).toContain(
      "locked Herdr worktree pool",
    );
    await writeFile(path.join(repo, "file"), "second\n");
    await git(repo, "commit", "-am", "Second");
    const latest = await git(repo, "rev-parse", "HEAD");
    await git(repo, "push", "origin", "main");
    await git(repo, "switch", "-c", "local-change", previous);
    await git(repo, "branch", "work", previous);
    const claims = await Promise.all([
      allocate({ ...setup, branch: "work", generated: true }, true),
      allocate({ ...setup, branch: "work", generated: true }, true),
    ]);
    expect(claims.map((claim) => claim.branch).sort()).toEqual([
      "work-2",
      "work-3",
    ]);
    const consumed = await Promise.all(
      claims.map((claim) => git(claim.path, "rev-parse", "--absolute-git-dir")),
    );
    expect(new Set(consumed).size).toBe(2);
    expect(stageIds).toEqual(expect.arrayContaining(consumed));
    for (const claim of claims)
      expect(await git(claim.path, "rev-parse", "HEAD")).toBe(latest);
    expect(await replenish(setup, false)).toBe(3);
    expect(await stagesOf(repo)).toHaveLength(3);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

test("keeps existing branch history and refuses to launch a new branch when fetching fails", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    const original = await git(repo, "rev-parse", "HEAD");
    await git(repo, "branch", "saved", original);
    await git(
      repo,
      "remote",
      "set-url",
      "origin",
      path.join(tmp, "missing-origin"),
    );
    const saved = await allocate(
      { ...setup, branch: "saved", generated: false },
      true,
    );
    expect(await git(saved.path, "rev-parse", "HEAD")).toBe(original);
    expect(await git(saved.path, "branch", "--show-current")).toBe("saved");
    await expect(
      allocate({ ...setup, branch: "new", generated: true }, true),
    ).rejects.toThrow("Could not fetch origin/main");
    expect(await git(repo, "branch", "--list", "new")).toBe("");
    expect(await readdir(setup.root)).toEqual(["saved"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

test("fills a missing slot and preserves files in a dirty staged checkout", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    const first = await allocate(
      { ...setup, branch: "first", generated: true },
      true,
    );
    expect(await git(first.path, "branch", "--show-current")).toBe("first");
    expect(await replenish(setup, false)).toBe(3);
    const [stage] = await stagesOf(repo);
    if (stage === undefined) throw new Error("No staged worktree");
    const untracked = path.join(stage, "keep-me");
    await writeFile(untracked, "personal data\n");
    expect(await replenish(setup, false)).toBe(3);
    expect(await readFile(untracked, "utf8")).toBe("personal data\n");
    expect(await stagesOf(repo)).toHaveLength(4);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

test("restores a checkout stranded between the claim move and branch creation", async () => {
  const setup = await fixture();
  const { repo, tmp, root } = setup;
  try {
    expect(await replenish(setup, true)).toBe(3);
    const [stage] = await stagesOf(repo);
    if (stage === undefined) throw new Error("No staged worktree");
    const admin = await git(stage, "rev-parse", "--absolute-git-dir");
    const name = path.basename(stage);
    const physicalRoot = await realpath(root);
    const target = path.join(physicalRoot, "interrupted");
    await writeFile(`${stage}.json`, JSON.stringify({ name, admin, target }));
    await git(repo, "worktree", "unlock", stage);
    await git(repo, "worktree", "move", stage, target);
    expect(await replenish(setup, false)).toBe(3);
    expect(await git(stage, "rev-parse", "--absolute-git-dir")).toBe(admin);
    expect(await git(repo, "worktree", "list", "--porcelain")).not.toContain(
      "interrupted",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

function fakeToolkit(overrides: Partial<Toolkit> = {}) {
  const started: [string, ...string[]][] = [];
  const toolkit: Toolkit = {
    platform: "darwin",
    startToolkit(cwd, args) {
      started.push([cwd, ...args]);
      return Promise.resolve(true);
    },
    ...overrides,
  };
  return { toolkit, started };
}

test("each new slot starts sharing its files with the main checkout once, without waiting", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    const fake = fakeToolkit();
    expect(await replenish(setup, true, fake.toolkit)).toBe(3);
    const stages = await stagesOf(repo);
    expect(fake.started.map(([cwd]) => cwd).sort()).toEqual(stages.sort());
    for (const [cwd, ...args] of fake.started)
      expect(args).toEqual([
        "tend",
        "dedupe",
        "--worktree",
        cwd,
        "--apply",
        "--no-refresh",
        "--lock-wait",
        "15m",
      ]);
    // A full pool makes no slot, so it shares nothing again.
    fake.started.length = 0;
    expect(await replenish(setup, false, fake.toolkit)).toBe(3);
    expect(fake.started).toEqual([]);
    // One claim leaves a gap, and only the replacement slot is started.
    const claimed = await allocate(
      { ...setup, branch: "work", generated: true },
      true,
    );
    expect(await replenish(setup, false, fake.toolkit)).toBe(3);
    expect(fake.started).toHaveLength(1);
    expect(fake.started.map(([cwd]) => cwd)).not.toContain(claimed.path);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 30_000);

test("sharing is skipped off macOS and never fails a refill", async () => {
  const unavailable: Toolkit = {
    platform: "darwin",
    startToolkit: () => Promise.resolve(false),
  };
  const rejecting: Toolkit = {
    platform: "darwin",
    startToolkit: () => Promise.reject(new Error("spawn EACCES")),
  };
  const throwing: Toolkit = {
    platform: "darwin",
    startToolkit: () => {
      throw new Error("spawn ENOENT");
    },
  };
  const linux = fakeToolkit({ platform: "linux" });
  for (const toolkit of [linux.toolkit, unavailable, rejecting, throwing]) {
    const setup = await fixture();
    try {
      expect(await replenish(setup, true, toolkit)).toBe(3);
    } finally {
      await rm(setup.tmp, { recursive: true, force: true });
    }
  }
  expect(linux.started).toEqual([]);
}, 60_000);

test("claiming a slot leaves unchanged files as they were, so their sharing survives", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    await writeFile(path.join(repo, "stable"), "unchanged\n");
    await git(repo, "add", "stable");
    await git(repo, "commit", "-m", "Stable");
    await git(repo, "push", "origin", "main");
    expect(await replenish(setup, true)).toBe(3);
    const [stage] = await stagesOf(repo);
    if (stage === undefined) throw new Error("No staged worktree");
    // Stand in for the dedupe: a different inode with the same bytes, the way
    // an APFS clone replaces a file.
    const replaced = path.join(stage, "stable");
    await writeFile(`${replaced}.clone`, "unchanged\n");
    await rename(`${replaced}.clone`, replaced);
    const { ino: before } = await stat(replaced);
    // The claim lands on a newer main, so changed files are rewritten.
    await writeFile(path.join(repo, "file"), "second\n");
    await git(repo, "commit", "-am", "Second");
    await git(repo, "push", "origin", "main");
    const fake = fakeToolkit();
    const claimed = await allocate(
      { ...setup, branch: "work", generated: true },
      true,
      fake.toolkit,
    );
    expect(claimed.dedupe).toBe("started");
    expect(fake.started).toEqual([
      [
        claimed.path,
        "tend",
        "dedupe",
        "--worktree",
        claimed.path,
        "--apply",
        "--no-refresh",
        "--lock-wait",
        "15m",
      ],
    ]);
    expect(await git(claimed.path, "status", "--porcelain")).toBe("");
    const { ino: after } = await stat(path.join(claimed.path, "stable"));
    expect(after).toBe(before);
    expect(await readFile(path.join(claimed.path, "file"), "utf8")).toBe(
      "second\n",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 30_000);

test("the allocating Mac shares every kind of checkout it hands out, and a failed start never fails the claim", async () => {
  const setup = await fixture();
  const { repo, tmp } = setup;
  try {
    const fake = fakeToolkit();
    // No slot is ready, so this one is created directly from origin/main.
    const direct = await allocate(
      { ...setup, branch: "direct", generated: true },
      false,
      fake.toolkit,
    );
    expect(direct.dedupe).toBe("started");
    // An existing branch is opened as a worktree.
    await git(repo, "branch", "saved", "HEAD");
    const existing = await allocate(
      { ...setup, branch: "saved", generated: false },
      false,
      fake.toolkit,
    );
    expect(existing.dedupe).toBe("started");
    expect(fake.started.map((call) => [call[0], call[4]])).toEqual([
      [direct.path, direct.path],
      [existing.path, existing.path],
    ]);
    const other = fakeToolkit({ platform: "linux" });
    const onLinux = await allocate(
      { ...setup, branch: "linux", generated: true },
      false,
      other.toolkit,
    );
    expect(onLinux.dedupe).toBe("skipped");
    expect(other.started).toEqual([]);
    const withoutToolkit = await allocate(
      { ...setup, branch: "bare", generated: true },
      false,
    );
    expect(withoutToolkit.dedupe).toBe("skipped");
    for (const startToolkit of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error("spawn EACCES")),
      () => {
        throw new Error("spawn ENOENT");
      },
    ]) {
      const failing = fakeToolkit({ startToolkit });
      const claimed = await allocate(
        { ...setup, branch: "failing", generated: true },
        false,
        failing.toolkit,
      );
      expect(claimed.dedupe).toBe("skipped");
      expect(await git(claimed.path, "status", "--porcelain")).toBe("");
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("a claim hands the dedupe to launchd and returns, and a refused handoff only skips it", async () => {
  const setup = await fixture();
  const { tmp } = setup;
  const toolkit = path.join(tmp, "toolkit");
  await writeFile(toolkit, "#!/bin/sh\n", { mode: 0o755 });
  const bootstraps: string[] = [];
  const logged: string[] = [];
  const launchd = (code: number): Launchd => ({
    platform: "darwin",
    uid: 501,
    home: tmp,
    path: "/usr/bin:/bin",
    now: () => 1_700_000_000_000,
    launchctl: async (args) => {
      if (args[0] === "bootstrap")
        bootstraps.push(await readFile(String(args[2]), "utf8"));
      return {
        code: args[0] === "bootstrap" ? code : 0,
        stdout: "",
        stderr: "",
      };
    },
    logError: (message) => logged.push(message),
  });
  try {
    const labels: string[] = [];
    const claimed = await allocate(
      { ...setup, branch: "work", generated: true },
      false,
      {
        platform: "darwin",
        startToolkit: (cwd, args) =>
          startDetachedToolkit(toolkit, cwd, args, {
            submitted: (job) => {
              labels.push(job);
            },
            launchd: launchd(0),
          }),
      },
    );
    expect(claimed.dedupe).toBe("started");
    expect(labels).toHaveLength(1);
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]).toContain(
      `<string>${toolkit}</string><string>tend</string><string>dedupe</string><string>--worktree</string><string>${claimed.path}</string><string>--apply</string><string>--no-refresh</string><string>--lock-wait</string><string>15m</string>`,
    );
    // No GUI login (nobody signed in on the Mac): skipped, and the claim stands.
    const refused: Toolkit = {
      platform: "darwin",
      startToolkit: (cwd, args) =>
        startDetachedToolkit(toolkit, cwd, args, { launchd: launchd(5) }),
    };
    const second = await allocate(
      { ...setup, branch: "second", generated: true },
      false,
      refused,
    );
    expect(second.dedupe).toBe("skipped");
    expect(await git(second.path, "status", "--porcelain")).toBe("");
    expect(await replenish(setup, true, refused)).toBe(3);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 60_000);
