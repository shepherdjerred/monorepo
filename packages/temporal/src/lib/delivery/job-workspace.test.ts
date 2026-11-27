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
import {
  withWorkerCandidateCheckout,
  workerCandidateEnvironment,
} from "#lib/delivery/workers/worker-candidate-checkout.ts";

const MONOREPO = "https://github.com/shepherdjerred/monorepo.git";
const SECTION_START =
  "mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise /workspace/git/objects/pack\n";
const MISE_START = "cp -Rsf /opt/mise/. /workspace/mise/\n";
const STORE_START = "export GIT_CONFIG_GLOBAL=";
const SECTION_END = "cd /workspace/source\n";
const INSTALL_MARKER = "node_modules/.delivery-install-complete";
const STORE_RESET = '"event":"git-store-reset"';

type Environment = Record<string, string | undefined>;

let base = "";
let origin = "";
const environment: Environment = {};
/**
 * c1-c3 are commits on the origin's branch. e1 adds `* text=auto eol=lf`,
 * an LF blob, a CRLF blob and an `eol=crlf` script; e2 changes only the CRLF
 * blob's line endings. Both are written with plumbing, byte for byte.
 */
const revisions: Record<"c1" | "c2" | "c3" | "e1" | "e2", string> = {
  c1: "",
  c2: "",
  c3: "",
  e1: "",
  e2: "",
};

/** The environment with `extra` applied; an undefined value removes a variable. */
function withEnvironment(extra: Environment) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...environment, ...extra }))
    if (value !== undefined) merged[key] = value;
  return merged;
}

function spawn(
  argv: string[],
  cwd: string,
  extra: Environment = {},
  stdin?: string,
) {
  const result = Bun.spawnSync(argv, {
    cwd,
    env: withEnvironment(extra),
    ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function git(
  args: string[],
  cwd = origin,
  extra: Environment = {},
  stdin?: string,
) {
  const result = spawn(["git", ...args], cwd, extra, stdin);
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

/**
 * A child of `parent` whose blobs are exactly `files`' bytes, written without
 * attributes or conversion and without moving the origin's branch.
 */
function plumb(parent: string, files: Record<string, string>, message: string) {
  const index = { GIT_INDEX_FILE: path.join(base, `index-${message}`) };
  git(["read-tree", parent], origin, index);
  for (const [file, content] of Object.entries(files)) {
    const oid = git(
      ["hash-object", "-w", "--no-filters", "--stdin"],
      origin,
      {},
      content,
    );
    git(
      ["update-index", "--add", "--cacheinfo", `100644,${oid},${file}`],
      origin,
      index,
    );
  }
  const tree = git(["write-tree"], origin, index);
  return git(["commit-tree", tree, "-p", parent, "-m", message]);
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

function runJob(root: string, revision: string, extra: Environment = {}) {
  return spawn(
    ["bash", "-c", `set -euo pipefail\n${sourceSection(root)}`],
    base,
    { DELIVERY_SOURCE_REVISION: revision, ...extra },
  );
}

/** Candidate commands with real Git under `extra`; install and build commands are not under test. */
function gitOnly(extra: Environment = {}) {
  return async (argv: readonly string[], cwd: string) => {
    if (argv[0] !== "git") return { stdout: "", stderr: "" };
    const result = spawn([...argv], cwd, extra);
    if (result.exitCode !== 0)
      throw new Error(`${argv.join(" ")} failed: ${result.stderr}`);
    return { stdout: result.stdout, stderr: "" };
  };
}
const realGitOnly = gitOnly();

async function claim(name: string) {
  const root = path.join(base, name);
  await mkdir(root);
  return root;
}

async function packs(root: string) {
  const names = await readdir(path.join(root, "git/objects/pack"));
  return names.filter((name) => name.endsWith(".pack")).sort();
}

async function present(file: string) {
  return await lstat(file).then(
    () => true,
    () => false,
  );
}

/**
 * Every tracked file of `revision` is a regular file with exactly its blob's
 * bytes and executable bit, except `converted` files, which the revision's
 * attributes rewrite on checkout and the caller checks itself.
 */
async function expectExactTree(
  checkout: string,
  revision: string,
  converted: readonly string[] = [],
) {
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
  const exact = entries.filter(({ file }) => !converted.includes(file));
  const hashed = git(
    ["hash-object", "--no-filters", "--stdin-paths"],
    origin,
    {},
    exact.map(({ file }) => path.join(checkout, file)).join("\n"),
  );
  expect(hashed.split("\n")).toEqual(exact.map(({ oid }) => oid));
}

/**
 * Git configuration and attributes a candidate test could leave in the kept
 * job home: hooks and an fsmonitor that run code (each touches `ran`), a
 * template directory that would plant hooks in a fresh repository, a clean
 * filter that reports `a.txt` as its committed content whatever it holds, and Git's
 * default user attributes file asking for CRLF on checkout.
 */
async function plantHome(home: string, ran: string) {
  const script = async (file: string, body: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `#!/bin/sh\n${body}`);
    await chmod(file, 0o755);
  };
  for (const hook of [
    "post-checkout",
    "post-index-change",
    "reference-transaction",
  ]) {
    await script(path.join(home, "hooks", hook), `touch '${ran}'\n`);
    await script(path.join(home, "template/hooks", hook), `touch '${ran}'\n`);
  }
  await script(path.join(home, "fsmonitor"), `touch '${ran}'\nexit 1\n`);
  await script(
    path.join(home, "hide"),
    'cat >/dev/null\nexec git cat-file blob "HEAD:$1"\n',
  );
  await writeFile(path.join(home, "attributes"), "a.txt filter=hide\n");
  await writeFile(
    path.join(home, ".gitconfig"),
    [
      "[core]",
      `\tattributesFile = ${home}/attributes`,
      `\thooksPath = ${home}/hooks`,
      `\tfsmonitor = ${home}/fsmonitor`,
      '[filter "hide"]',
      `\tclean = ${home}/hide %f`,
      "[init]",
      `\ttemplateDir = ${home}/template`,
      "",
    ].join("\n"),
  );
  await mkdir(path.join(home, ".config/git"), { recursive: true });
  await writeFile(
    path.join(home, ".config/git/attributes"),
    "* text eol=crlf\n",
  );
}

/** Rewrite `file` with `content` of the same length, keeping its old mtime. */
async function tamper(file: string, content: string) {
  const original = await stat(file);
  await writeFile(file, content);
  await utimes(file, original.atime, original.mtime);
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "delivery-stage-workspace-"));
  origin = path.join(base, "origin");
  await mkdir(origin);
  Object.assign(environment, {
    PATH: Bun.env["PATH"],
    HOME: base,
    GIT_CONFIG_NOSYSTEM: "1",
    // Command-scope configuration, which the bootstrap's
    // GIT_CONFIG_GLOBAL=/dev/null leaves in place: the origin stands in for
    // GitHub.
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.file://${origin}.insteadOf`,
    GIT_CONFIG_VALUE_0: MONOREPO,
    GIT_CONFIG_KEY_1: "init.defaultBranch",
    GIT_CONFIG_VALUE_1: "main",
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
  revisions.e1 = plumb(
    revisions.c1,
    {
      ".gitattributes": "* text=auto eol=lf\n*.cmd text eol=crlf\n",
      "eol/lf.txt": "one\ntwo\n",
      "eol/crlf-blob.txt": "one\r\ntwo\r\n",
      "eol/run.cmd": "echo one\necho two\n",
    },
    "e1",
  );
  revisions.e2 = plumb(
    revisions.e1,
    { "eol/crlf-blob.txt": "one\ntwo\n" },
    "e2",
  );
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

  it("resets a dirty or tampered checkout to the revision and keeps only a completed node_modules", async () => {
    const root = await claim("tampered-checkout");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const source = path.join(root, "source");
    const file = (name: string) => path.join(source, name);
    // Same size and the old mtime: invisible to a stat-trusting index.
    await tamper(file("a.txt"), "omega\n");
    await rm(file("keep.txt"));
    await chmod(file("run.sh"), 0o644);
    await rm(file("dir/b.txt"));
    await symlink("/etc/hosts", file("dir/b.txt"));
    await writeFile(file("untracked.txt"), "stale\n");
    await mkdir(file("junk/deep"), { recursive: true });
    await writeFile(file("junk/deep/x.tf"), "stale\n");
    // An untracked attributes file would otherwise steer the reset's checkout.
    await writeFile(file("dir/.gitattributes"), "* text eol=crlf\n");
    git(["init", "-q", file("nested")]);
    await mkdir(file("node_modules/pkg"), { recursive: true });
    await writeFile(file("node_modules/pkg/index.js"), "kept\n");
    await writeFile(file(INSTALL_MARKER), "");
    await mkdir(file("packages/temporal/node_modules/dep"), {
      recursive: true,
    });
    await writeFile(file("packages/temporal/node_modules/dep/x.js"), "kept\n");
    // The previous repository metadata is untrusted too: hooks that the
    // Job's own read-tree and update-ref would run if it reused this .git.
    git(["update-index", "--assume-unchanged", "a.txt"], source);
    const ran = path.join(base, "checkout-hook-ran");
    for (const hook of ["post-index-change", "reference-transaction"]) {
      await writeFile(file(`.git/hooks/${hook}`), `#!/bin/sh\ntouch ${ran}\n`);
      await chmod(file(`.git/hooks/${hook}`), 0o755);
    }
    git(["read-tree", "HEAD"], source);
    expect(await present(ran)).toBe(true);
    await rm(ran);

    const result = runJob(root, revisions.c1);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    await expectExactTree(source, revisions.c1);
    for (const gone of [
      "untracked.txt",
      "junk",
      "nested",
      "dir/.gitattributes",
    ])
      await expect(lstat(file(gone))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await Bun.file(file("node_modules/pkg/index.js")).text()).toBe(
      "kept\n",
    );
    expect(
      await Bun.file(file("packages/temporal/node_modules/dep/x.js")).text(),
    ).toBe("kept\n");
    expect(await present(ran)).toBe(false);
    expect(
      git(["status", "--porcelain=v1", "--untracked-files=all"], source)
        .split("\n")
        .every((line) => line.includes("node_modules/")),
    ).toBe(true);
  }, 60_000);

  it("removes every node_modules an install left unfinished", async () => {
    const root = await claim("interrupted-install");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const file = (name: string) => path.join(root, "source", name);
    // An install cut short: packages written, completion marker never.
    await mkdir(file("node_modules/half"), { recursive: true });
    await writeFile(file("node_modules/half/index.js"), "partial");
    await mkdir(file("packages/temporal/node_modules/dep"), {
      recursive: true,
    });
    await writeFile(file("packages/temporal/node_modules/dep/x.js"), "");

    const result = runJob(root, revisions.c1);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      kind: "delivery-stage-workspace",
      event: "install-reset",
      checkout: "source",
    });
    for (const gone of ["node_modules", "packages/temporal/node_modules"])
      expect(await present(file(gone))).toBe(false);
    await expectExactTree(path.join(root, "source"), revisions.c1);
  }, 60_000);

  it("rewrites a CRLF copy of an LF blob and a line-ending-only change, byte for byte", async () => {
    const root = await claim("line-endings");
    const source = path.join(root, "source");
    const bytes = async (name: string) =>
      await Bun.file(path.join(source, name)).text();
    expect(runJob(root, revisions.e1)).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    await expectExactTree(source, revisions.e1, ["eol/run.cmd"]);
    expect(await bytes("eol/crlf-blob.txt")).toBe("one\r\ntwo\r\n");
    // The revision's own end-of-line attributes still apply on checkout.
    expect(await bytes("eol/run.cmd")).toBe("echo one\r\necho two\r\n");

    // From an index with no stat data, Git's own conversion hashes a CRLF
    // copy of the LF blob as that blob.
    await writeFile(path.join(source, "eol/lf.txt"), "one\r\ntwo\r\n");
    git(["read-tree", "HEAD"], source);
    git(["update-index", "-q", "--refresh"], source);
    expect(git(["status", "--porcelain=v1"], source)).toBe("");
    const unchanged = await stat(path.join(source, "keep.txt"));
    expect(runJob(root, revisions.e1)).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(await bytes("eol/lf.txt")).toBe("one\ntwo\n");
    expect(await bytes("eol/run.cmd")).toBe("echo one\r\necho two\r\n");
    await expectExactTree(source, revisions.e1, ["eol/run.cmd"]);
    const kept = await stat(path.join(source, "keep.txt"));
    expect([kept.ino, kept.mtimeMs]).toEqual([
      unchanged.ino,
      unchanged.mtimeMs,
    ]);

    // Only the blob's line endings change.
    expect(runJob(root, revisions.e2)).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(await bytes("eol/crlf-blob.txt")).toBe("one\ntwo\n");
    await expectExactTree(source, revisions.e2, ["eol/run.cmd"]);
  }, 60_000);

  it("ignores Git configuration and attributes left in the job home", async () => {
    const root = await claim("planted-home");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const source = path.join(root, "source");
    const home = path.join(root, "home");
    const ran = path.join(base, "planted-home-ran");
    await plantHome(home, ran);
    await tamper(path.join(source, "a.txt"), "omega\n");
    // With that home, plain Git runs the planted code, and the planted
    // filter calls the tampered file unchanged wherever its attributes apply.
    const planted = { HOME: home, GIT_CONFIG_NOSYSTEM: undefined };
    expect(
      git(
        ["-c", `core.attributesFile=${home}/attributes`, "status", "-s"],
        source,
        planted,
      ),
    ).toBe("");
    expect(await present(ran)).toBe(true);
    await rm(ran);

    const result = runJob(root, revisions.c1, planted);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    await expectExactTree(source, revisions.c1);
    expect(await present(ran)).toBe(false);
    expect(await present(path.join(source, ".git/hooks/post-checkout"))).toBe(
      false,
    );
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

  it("removes an interrupted fetch's leftovers and keeps the verified store", async () => {
    const root = await claim("interrupted-fetch");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    const fetched = await packs(root);
    const store = path.join(root, "git");
    const pack = (name: string) => path.join(store, "objects/pack", name);
    const orphan = `pack-${"a".repeat(40)}.pack`;
    const leftovers = [
      pack("tmp_pack_Xy12Ab"),
      pack("tmp_idx_Xy12Ab"),
      pack(`pack-${"a".repeat(40)}.promisor`),
      pack("multi-pack-index"),
      // A pack whose index was never written.
      pack(orphan),
      path.join(store, "objects/ab/tmp_obj_Xy12Ab"),
      path.join(store, "packed-refs.lock"),
    ];
    const past = new Date(Date.now() - 60_000);
    for (const file of leftovers) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "cut short");
      await utimes(file, past, past);
    }

    const result = runJob(root, revisions.c2);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // Verified and reused: no reset, no second whole-tree pack.
    expect(await packs(root)).toEqual(fetched);
    for (const file of leftovers) expect(await present(file), file).toBe(false);
    await expectExactTree(path.join(root, "source"), revisions.c2);
  }, 60_000);

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

describe("damaged Git object store", () => {
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
    [
      "a malformed shallow file",
      async (store: string) => {
        await writeFile(path.join(store, "shallow"), "not a revision\n");
      },
    ],
    [
      "an emptied shallow boundary",
      async (store: string) => {
        await writeFile(path.join(store, "shallow"), "");
      },
    ],
  ])(
    "fails loudly on %s and fetches into a fresh store",
    async (name, damage) => {
      const root = await claim(`damaged-${name.replaceAll(" ", "-")}`);
      expect(runJob(root, revisions.c1).exitCode).toBe(0);
      const store = path.join(root, "git");
      await damage(store);
      if (!name.includes("ref")) {
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
        expect(`${fsck.stdout}${fsck.stderr}`).toMatch(
          /error|fatal|missing|broken/u,
        );
      }
      const result = runJob(root, revisions.c2);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(STORE_RESET);
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

  it("fails loudly on a corrupt loose object and fetches into a fresh store", async () => {
    const root = await claim("damaged-loose-object");
    expect(runJob(root, revisions.c1).exitCode).toBe(0);
    // The next revision's few objects arrive loose.
    expect(runJob(root, revisions.c2).exitCode).toBe(0);
    const objects = path.join(root, "git/objects");
    const names = await readdir(objects);
    const directory = names.find((name) => /^[0-9a-f]{2}$/u.test(name)) ?? "";
    const [loose = ""] = await readdir(path.join(objects, directory));
    expect(loose).toMatch(/^[0-9a-f]{38}$/u);
    const file = path.join(objects, directory, loose);
    await chmod(file, 0o644);
    await writeFile(file, "not a zlib stream");

    const result = runJob(root, revisions.c3);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(STORE_RESET);
    await expectExactTree(path.join(root, "source"), revisions.c3);
    expect(runJob(root, revisions.c3).stderr).toBe("");
  }, 60_000);
});

/** A claim with the executor's checkout at c1 and candidate preparation over it. */
async function candidateClaim(name: string) {
  const root = await claim(name);
  expect(runJob(root, revisions.c1).exitCode).toBe(0);
  const candidateRoot = path.join(root, "candidate");
  const executor = {
    root: path.join(root, "source"),
    revision: revisions.c1,
  };
  const prepare = async (
    sourceRevision: string,
    execute: typeof realGitOnly = realGitOnly,
    at = candidateRoot,
  ) =>
    await withWorkerCandidateCheckout(
      { sourceRevision, target: "central", executor, candidateRoot: at },
      async () => "proved",
      { execute },
    );
  return { root, candidateRoot, executor, prepare };
}

/** Captures the candidate's JSON log lines (phase timings and events). */
async function withLog<T>(use: (lines: string[]) => Promise<T>) {
  const lines: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((line) => {
    lines.push(String(line));
  });
  try {
    return await use(lines);
  } finally {
    warn.mockRestore();
  }
}

/** Real Git; the install writes some packages and is then cut short. */
async function interruptedInstall(argv: readonly string[], cwd: string) {
  if (!argv.includes("--frozen-lockfile")) return await realGitOnly(argv, cwd);
  await mkdir(path.join(cwd, "node_modules/half"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules/half/index.js"), "part");
  throw new Error("bun install was killed");
}

describe("kept worker candidate checkout", () => {
  it("brings a dirty kept candidate tree to each candidate revision exactly", async () => {
    const { candidateRoot, executor, prepare } =
      await candidateClaim("candidate");
    await withLog(async () => {
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
      await writeFile(file(".gitattributes"), "* text eol=crlf\n");
      await mkdir(file("node_modules/pkg"), { recursive: true });
      await writeFile(file("node_modules/pkg/index.js"), "kept\n");
      // A hook the candidate's own read-tree would run in a reused .git.
      const ran = path.join(base, "candidate-hook-ran");
      await writeFile(
        file(".git/hooks/post-index-change"),
        `#!/bin/sh\ntouch ${ran}\n`,
      );
      await chmod(file(".git/hooks/post-index-change"), 0o755);
      git(["read-tree", "HEAD"], candidateRoot);
      expect(await present(ran)).toBe(true);
      await rm(ran);

      await expect(prepare(revisions.c3)).resolves.toBe("proved");
      await expectExactTree(candidateRoot, revisions.c3);
      for (const gone of ["untracked.txt", ".gitattributes"])
        expect(await present(file(gone))).toBe(false);
      expect(await present(ran)).toBe(false);
      // The previous candidate's install completed, so its packages stay.
      expect(await Bun.file(file("node_modules/pkg/index.js")).text()).toBe(
        "kept\n",
      );
      // The executor's checkout is untouched by its candidate.
      await expectExactTree(executor.root, revisions.c1);
      expect(git(["status", "--porcelain=v1"], executor.root)).toBe("");
    });
  }, 60_000);

  it("rewrites a CRLF copy of an LF blob and a line-ending-only change in the candidate", async () => {
    const { candidateRoot, prepare } = await candidateClaim("candidate-eol");
    await withLog(async () => {
      await expect(prepare(revisions.e1)).resolves.toBe("proved");
      const file = (name: string) => path.join(candidateRoot, name);
      expect(await Bun.file(file("eol/run.cmd")).text()).toBe(
        "echo one\r\necho two\r\n",
      );
      await writeFile(file("eol/lf.txt"), "one\r\ntwo\r\n");
      await expect(prepare(revisions.e1)).resolves.toBe("proved");
      expect(await Bun.file(file("eol/lf.txt")).text()).toBe("one\ntwo\n");
      await expectExactTree(candidateRoot, revisions.e1, ["eol/run.cmd"]);
      await expect(prepare(revisions.e2)).resolves.toBe("proved");
      expect(await Bun.file(file("eol/crlf-blob.txt")).text()).toBe(
        "one\ntwo\n",
      );
      await expectExactTree(candidateRoot, revisions.e2, ["eol/run.cmd"]);
    });
  }, 60_000);

  it("ignores Git configuration and attributes left in the job home", async () => {
    const { root, candidateRoot, prepare } = await candidateClaim(
      "candidate-planted-home",
    );
    const home = path.join(root, "home");
    const ran = path.join(base, "candidate-planted-home-ran");
    // Exactly what a candidate child receives, with the test's origin
    // redirect and the planted home.
    const candidate = gitOnly({
      ...Object.fromEntries(
        Object.keys(environment)
          .filter((key) => !["PATH", "HOME"].includes(key))
          .filter((key) => !key.startsWith("GIT_CONFIG_"))
          .map((key) => [key, undefined]),
      ),
      ...workerCandidateEnvironment("prod"),
      PATH: Bun.env["PATH"],
      HOME: home,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.file://${origin}.insteadOf`,
      GIT_CONFIG_VALUE_0: MONOREPO,
    });
    await withLog(async () => {
      await expect(prepare(revisions.c2, candidate)).resolves.toBe("proved");
      await plantHome(home, ran);
      await tamper(path.join(candidateRoot, "a.txt"), "omega two\n");
      const planted = { HOME: home, GIT_CONFIG_NOSYSTEM: undefined };
      expect(
        git(
          [
            "-c",
            `core.attributesFile=${home}/attributes`,
            "status",
            "-s",
            "--untracked-files=no",
          ],
          candidateRoot,
          planted,
        ),
      ).toBe("");
      expect(await present(ran)).toBe(true);
      await rm(ran);

      await expect(prepare(revisions.c2, candidate)).resolves.toBe("proved");
      await expectExactTree(candidateRoot, revisions.c2);
      expect(await present(ran)).toBe(false);
    });
  }, 60_000);

  it("removes every node_modules an interrupted candidate install left", async () => {
    const { candidateRoot, prepare } = await candidateClaim(
      "candidate-interrupted-install",
    );
    const file = (name: string) => path.join(candidateRoot, name);
    await withLog(async (lines) => {
      await expect(prepare(revisions.c2, interruptedInstall)).rejects.toThrow(
        "bun install was killed",
      );
      expect(await present(file(INSTALL_MARKER))).toBe(false);

      await expect(prepare(revisions.c2)).resolves.toBe("proved");
      expect(await present(file("node_modules/half"))).toBe(false);
      expect(await present(file(INSTALL_MARKER))).toBe(true);
      expect(
        lines
          .filter((line) => line.includes('"event":"install-reset"'))
          .map((line): unknown => JSON.parse(line)),
      ).toEqual([
        expect.objectContaining({
          kind: "delivery-stage-workspace",
          checkout: "candidate",
        }),
      ]);
      await expectExactTree(candidateRoot, revisions.c2);
    });
  }, 60_000);

  it("never lets a symlinked candidate tree reach the executor's checkout", async () => {
    const { root, candidateRoot, executor, prepare } =
      await candidateClaim("candidate-symlink");
    await withLog(async () => {
      // A link a candidate test left in place of the kept candidate tree.
      await symlink(executor.root, candidateRoot);
      await expect(prepare(revisions.c2)).resolves.toBe("proved");
      const kept = await lstat(candidateRoot);
      expect([kept.isDirectory(), kept.isSymbolicLink()]).toEqual([
        true,
        false,
      ]);
      await expectExactTree(candidateRoot, revisions.c2);

      // A link above the candidate tree that lands it inside the executor's.
      await symlink(executor.root, path.join(root, "into-source"));
      await expect(
        prepare(
          revisions.c3,
          realGitOnly,
          path.join(root, "into-source/candidate"),
        ),
      ).rejects.toThrow("must not replace the executor's");
      expect(await present(path.join(executor.root, "candidate"))).toBe(false);
      await expectExactTree(executor.root, revisions.c1);
      expect(git(["status", "--porcelain=v1"], executor.root)).toBe("");
    });
  }, 60_000);
});
