/**
 * Runs the stage bootstrap's real source preparation (DELIVERY_JOB_BOOTSTRAP,
 * from the kept object store to the clean checkout) and the worker candidate
 * checkout with real Git against a local origin, on a claim directory reused
 * across simulated Jobs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DELIVERY_JOB_BOOTSTRAP } from "#shared/delivery-job.ts";
import { withWorkerCandidateCheckout } from "#lib/delivery/workers/worker-candidate-checkout.ts";

const MONOREPO = "https://github.com/shepherdjerred/monorepo.git";
const SECTION_START =
  "mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise /workspace/git/objects/pack\n";
const MISE_START = "cp -Rsf /opt/mise/. /workspace/mise/\n";
const STORE_START = "previous=\n";
const SECTION_END = "cd /workspace/source\n";

let base = "";
let origin = "";
const environment: Record<string, string | undefined> = {};
const revisions: Record<"c1" | "c2" | "c3", string> = {
  c1: "",
  c2: "",
  c3: "",
};

function spawn(
  argv: string[],
  cwd: string,
  extra: Record<string, string> = {},
) {
  const result = Bun.spawnSync(argv, {
    cwd,
    env: { ...environment, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function git(args: string[], cwd = origin) {
  const result = spawn(["git", ...args], cwd);
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function commit(files: Record<string, string | null>, message: string) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(origin, file);
    if (content === null) await rm(target, { force: true });
    else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

/** 150 files, so a whole-tree fetch arrives as a pack rather than loose objects. */
const bulk = (tag: string, count = 150) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `bulk/${tag}/${String(index)}.txt`,
      `${tag} ${String(index)}\n`,
    ]),
  );

/** The bootstrap's source preparation, with `/workspace` at `root`. */
function sourceSection(root: string) {
  const start = DELIVERY_JOB_BOOTSTRAP.indexOf(SECTION_START);
  const mise = DELIVERY_JOB_BOOTSTRAP.indexOf(MISE_START);
  const store = DELIVERY_JOB_BOOTSTRAP.indexOf(STORE_START);
  const end = DELIVERY_JOB_BOOTSTRAP.indexOf(SECTION_END);
  if ([start, mise, store, end].includes(-1) || !(mise < store))
    throw new Error("Bootstrap source preparation moved");
  // The image toolchain lines between them need /opt/mise; skip only those.
  return `${DELIVERY_JOB_BOOTSTRAP.slice(start, mise)}${DELIVERY_JOB_BOOTSTRAP.slice(store, end)}`.replaceAll(
    "/workspace/",
    `${root}/`,
  );
}

function runJob(root: string, revision: string) {
  return spawn(
    ["bash", "-c", `set -euo pipefail\n${sourceSection(root)}`],
    base,
    { DELIVERY_SOURCE_REVISION: revision },
  );
}

/** Candidate commands with real Git; install and build commands are not under test. */
async function realGitOnly(argv: readonly string[], cwd: string) {
  if (argv[0] !== "git") return { stdout: "", stderr: "" };
  const result = spawn([...argv], cwd);
  if (result.exitCode !== 0)
    throw new Error(`${argv.join(" ")} failed: ${result.stderr}`);
  return { stdout: result.stdout, stderr: "" };
}

async function claim(name: string) {
  const root = path.join(base, name);
  await mkdir(root);
  return root;
}

async function packs(root: string) {
  const names = await readdir(path.join(root, "git/objects/pack"));
  return names.filter((name) => name.endsWith(".pack")).sort();
}

/** Every tracked file of `revision` is a regular file with exactly its blob and executable bit. */
async function expectExactTree(checkout: string, revision: string) {
  const entries = git(["ls-tree", "-r", revision])
    .split("\n")
    .map((line) => {
      const [meta = "", file = ""] = line.split("\t");
      const [mode = "", , oid = ""] = meta.split(" ");
      return { mode, oid, file };
    });
  for (const { mode, file } of entries) {
    const info = await lstat(path.join(checkout, file));
    expect(info.isFile(), file).toBe(true);
    expect(Boolean(info.mode & 0o100), file).toBe(mode === "100755");
  }
  const hashed = Bun.spawnSync(["git", "hash-object", "--stdin-paths"], {
    cwd: origin,
    env: environment,
    stdin: Buffer.from(
      entries.map(({ file }) => path.join(checkout, file)).join("\n"),
    ),
    stdout: "pipe",
  });
  expect(hashed.stdout.toString().trim().split("\n")).toEqual(
    entries.map(({ oid }) => oid),
  );
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "delivery-stage-workspace-"));
  origin = path.join(base, "origin");
  await mkdir(origin);
  const gitConfig = path.join(base, "gitconfig");
  await writeFile(
    gitConfig,
    `[url "file://${origin}"]\n\tinsteadOf = ${MONOREPO}\n[init]\n\tdefaultBranch = main\n`,
  );
  Object.assign(environment, {
    PATH: Bun.env["PATH"],
    HOME: base,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "delivery-test",
    GIT_AUTHOR_EMAIL: "delivery-test@localhost",
    GIT_COMMITTER_NAME: "delivery-test",
    GIT_COMMITTER_EMAIL: "delivery-test@localhost",
  });
  git(["init", "-q"]);
  git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
  git(["config", "uploadpack.allowFilter", "true"]);
  await commit({ README: "root\n" }, "root");
  revisions.c1 = await commit(
    {
      ...bulk("c1"),
      "a.txt": "alpha\n",
      "dir/b.txt": "bravo\n",
      "keep.txt": "same\n",
      "run.sh": "echo run\n",
      "packages/temporal/marker.txt": "temporal\n",
    },
    "c1",
  );
  await chmod(path.join(origin, "run.sh"), 0o755);
  git(["add", "-A"]);
  git(["commit", "-q", "--amend", "-m", "c1"]);
  revisions.c1 = git(["rev-parse", "HEAD"]);
  revisions.c2 = await commit(
    { "a.txt": "alpha two\n", "dir/b.txt": null, "c.txt": "charlie\n" },
    "c2",
  );
  revisions.c3 = await commit({ "c.txt": "charlie three\n" }, "c3");
}, 60_000);

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("stage workspace source preparation", () => {
  it("fetches into an empty claim, then downloads and rewrites only what changed", async () => {
    const root = await claim("incremental");
    const first = runJob(root, revisions.c1);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    const source = path.join(root, "source");
    expect(git(["rev-parse", "HEAD"], source)).toBe(revisions.c1);
    expect(
      git([
        "--git-dir",
        path.join(root, "git"),
        "rev-parse",
        "delivery-checkout",
      ]),
    ).toBe(revisions.c1);
    await expectExactTree(source, revisions.c1);
    const fetched = await packs(root);
    expect(fetched).toHaveLength(1);
    const before = await stat(path.join(source, "keep.txt"));

    // The same revision again: nothing is downloaded and nothing rewritten.
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    expect(await packs(root)).toEqual(fetched);
    const again = await stat(path.join(source, "keep.txt"));
    expect([again.ino, again.mtimeMs]).toEqual([before.ino, before.mtimeMs]);

    // The next revision: negotiation against the kept ref brings only the new
    // objects (loose, not another whole-tree pack); unchanged files stay put.
    expect(runJob(root, revisions.c2).exitCode).toBe(0);
    expect(await packs(root)).toEqual(fetched);
    expect(git(["rev-parse", "HEAD"], source)).toBe(revisions.c2);
    await expectExactTree(source, revisions.c2);
    await expect(stat(path.join(source, "dir/b.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const after = await stat(path.join(source, "keep.txt"));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  }, 60_000);

  it("resets a dirty or tampered checkout to the revision and keeps only node_modules", async () => {
    const root = await claim("tampered-checkout");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const source = path.join(root, "source");
    const file = (name: string) => path.join(source, name);
    // Same size and the old mtime: invisible to a stat-trusting index.
    const original = await stat(file("a.txt"));
    await writeFile(file("a.txt"), "omega\n");
    await utimes(file("a.txt"), original.atime, original.mtime);
    await rm(file("keep.txt"));
    await chmod(file("run.sh"), 0o644);
    await rm(file("dir/b.txt"));
    await symlink("/etc/hosts", file("dir/b.txt"));
    await writeFile(file("untracked.txt"), "stale\n");
    await mkdir(file("junk/deep"), { recursive: true });
    await writeFile(file("junk/deep/x.tf"), "stale\n");
    git(["init", "-q", file("nested")]);
    await mkdir(file("node_modules/pkg"), { recursive: true });
    await writeFile(file("node_modules/pkg/index.js"), "kept\n");
    await mkdir(file("packages/temporal/node_modules/dep"), {
      recursive: true,
    });
    await writeFile(file("packages/temporal/node_modules/dep/x.js"), "kept\n");
    // The previous repository metadata is untrusted too.
    git(["update-index", "--assume-unchanged", "a.txt"], source);
    const marker = path.join(base, "checkout-hook-ran");
    await writeFile(
      file(".git/hooks/post-checkout"),
      `#!/bin/sh\ntouch ${marker}\n`,
    );
    await chmod(file(".git/hooks/post-checkout"), 0o755);

    const result = runJob(root, revisions.c1);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    await expectExactTree(source, revisions.c1);
    for (const gone of ["untracked.txt", "junk", "nested"])
      await expect(lstat(file(gone))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await Bun.file(file("node_modules/pkg/index.js")).text()).toBe(
      "kept\n",
    );
    expect(
      await Bun.file(file("packages/temporal/node_modules/dep/x.js")).text(),
    ).toBe("kept\n");
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      git(["status", "--porcelain=v1", "--untracked-files=all"], source)
        .split("\n")
        .every((line) => line.includes("node_modules/")),
    ).toBe(true);
  }, 60_000);
});

describe("kept Git object store", () => {
  it("rebuilds everything in the kept store but its objects, shallow boundary and ref", async () => {
    const root = await claim("tampered-store");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const store = path.join(root, "git");
    const marker = path.join(base, "store-hook-ran");
    await mkdir(path.join(store, "hooks"), { recursive: true });
    await writeFile(
      path.join(store, "hooks/reference-transaction"),
      `#!/bin/sh\ntouch ${marker}\n`,
    );
    await chmod(path.join(store, "hooks/reference-transaction"), 0o755);
    // A redirect of the origin to nowhere: the fetch fails if this survives.
    await Bun.write(
      path.join(store, "config"),
      `${await Bun.file(path.join(store, "config")).text()}[url "file:///nonexistent/monorepo.git"]\n\tinsteadOf = ${MONOREPO}\n`,
    );
    await mkdir(path.join(store, "objects/info"), { recursive: true });
    await writeFile(
      path.join(store, "objects/info/alternates"),
      `${path.join(base, "elsewhere/objects")}\n`,
    );
    for (const lock of ["shallow.lock", "HEAD.lock", "config.lock"])
      await writeFile(path.join(store, lock), "");
    await writeFile(
      path.join(store, "objects/pack/pack-0000.keep"),
      "held by a killed Job",
    );

    const result = runJob(root, revisions.c2);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    await expectExactTree(path.join(root, "source"), revisions.c2);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await Bun.file(path.join(store, "config")).text()).not.toContain(
      "nonexistent",
    );
    const left = await readdir(store);
    for (const gone of ["shallow.lock", "HEAD.lock", "config.lock"])
      expect(left).not.toContain(gone);
    expect(await readdir(path.join(store, "objects/pack"))).not.toContain(
      "pack-0000.keep",
    );
    await expect(
      stat(path.join(store, "objects/info/alternates")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it.each([
    [
      "a corrupt pack",
      async (store: string) => {
        const [pack = ""] = await packs(path.dirname(store));
        const file = path.join(store, "objects/pack", pack);
        await chmod(file, 0o644);
        const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
        bytes.fill(0, 64, 96);
        await writeFile(file, bytes);
      },
    ],
    [
      "a missing pack",
      async (store: string) => {
        for (const name of await readdir(path.join(store, "objects/pack")))
          if (name.endsWith(".pack"))
            await rm(path.join(store, "objects/pack", name));
      },
    ],
    [
      "a malformed ref",
      async (store: string) => {
        await writeFile(
          path.join(store, "refs/heads/delivery-checkout"),
          "not a revision\n",
        );
      },
    ],
    [
      "a ref to an object the store lacks",
      async (store: string) => {
        await writeFile(
          path.join(store, "refs/heads/delivery-checkout"),
          `${"0".repeat(39)}1\n`,
        );
      },
    ],
  ])(
    "fails loudly on %s and fetches into a fresh store",
    async (name, damage) => {
      const root = await claim(`damaged-${name.replaceAll(" ", "-")}`);
      expect(runJob(root, revisions.c1).exitCode).toBe(0);
      const store = path.join(root, "git");
      await damage(store);
      if (name.includes("pack")) {
        // The verification itself fails, with Git's own errors on stderr.
        const fsck = spawn(
          [
            "git",
            `--git-dir=${store}`,
            "fsck",
            "--full",
            "--no-dangling",
            "--no-progress",
          ],
          base,
        );
        expect(fsck.exitCode).not.toBe(0);
        expect(fsck.stderr).toMatch(/error|fatal|missing/u);
      }
      const result = runJob(root, revisions.c2);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(
        "Delivery stage workspace: the kept Git object store failed verification; this Job fetches a fresh one",
      );
      await expectExactTree(path.join(root, "source"), revisions.c2);
      expect(
        spawn(
          ["git", `--git-dir=${store}`, "fsck", "--full", "--no-dangling"],
          base,
        ).exitCode,
      ).toBe(0);
      // A healthy store passes silently on the next Job.
      expect(runJob(root, revisions.c2).stderr).toBe("");
    },
    60_000,
  );

  it("keeps the store at about one revision's objects", async () => {
    const root = await claim("bounded");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const counts: number[] = [];
    let revision = revisions.c1;
    for (let step = 0; step < 10; step += 1) {
      revision = await commit(
        bulk(`step-${String(step)}`, 120),
        `step ${String(step)}`,
      );
      const result = runJob(root, revision);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const kept = await packs(root);
      counts.push(kept.length);
    }
    // One pack per revision until the ninth, then a single repacked pack.
    expect(Math.max(...counts)).toBeLessThanOrEqual(9);
    expect(counts).toContain(1);
    const store = path.join(root, "git");
    const boundary = await Bun.file(path.join(store, "shallow")).text();
    const shallow = boundary.trim().split("\n");
    expect(shallow.length).toBeLessThanOrEqual(counts.at(-1) ?? 0);
    expect(shallow).toContain(revision);
    await expectExactTree(path.join(root, "source"), revision);
  }, 120_000);
});

describe("kept worker candidate checkout", () => {
  it("brings a dirty kept candidate tree to each candidate revision exactly", async () => {
    const root = await claim("candidate");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const candidateRoot = path.join(root, "candidate");
    const executor = {
      root: path.join(root, "source"),
      revision: revisions.c1,
    };
    const prepare = (sourceRevision: string) =>
      withWorkerCandidateCheckout(
        { sourceRevision, target: "central", executor, candidateRoot },
        async () => "proved",
        { execute: realGitOnly },
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Phase timing lines are not under test here.
    });
    try {
      await expect(prepare(revisions.c2)).resolves.toBe("proved");
      await expectExactTree(candidateRoot, revisions.c2);
      expect(
        await Bun.file(
          path.join(candidateRoot, ".git/objects/info/alternates"),
        ).text(),
      ).toBe(`${path.join(executor.root, ".git/objects")}\n`);

      const file = (name: string) => path.join(candidateRoot, name);
      await writeFile(file("a.txt"), "tampered\n");
      await writeFile(file("untracked.txt"), "stale\n");
      await mkdir(file("node_modules/pkg"), { recursive: true });
      await writeFile(file("node_modules/pkg/index.js"), "kept\n");
      await expect(prepare(revisions.c3)).resolves.toBe("proved");
      await expectExactTree(candidateRoot, revisions.c3);
      await expect(stat(file("untracked.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await Bun.file(file("node_modules/pkg/index.js")).text()).toBe(
        "kept\n",
      );
      // The executor's checkout is untouched by its candidate.
      await expectExactTree(executor.root, revisions.c1);
      expect(git(["status", "--porcelain=v1"], executor.root)).toBe("");
    } finally {
      warn.mockRestore();
    }
  }, 60_000);
});
