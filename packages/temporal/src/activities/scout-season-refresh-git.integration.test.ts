import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  assertRemoteBranchIsOurs,
  changedFilesInPaths,
  runCommand,
} from "./scout-season-refresh-git.ts";

// These tests drive `changedFilesInPaths` against a REAL git repository rather
// than feeding a hand-written string to the parser.
//
// That distinction is the whole point. The pure-parser unit tests in
// shared/porcelain.test.ts all passed for months while this function returned
// mangled paths in production, because the defect was the interaction between
// `runCommand`'s default `stdout.trim()` and porcelain v1's leading-space
// status code — a seam no parser-only test can reach. Two bot PRs (#1709,
// #1971) shipped `ackages/scout-for-lol/...` and a permanently-dead
// timestamp-only suppression before anyone noticed.
describe("changedFilesInPaths (real git repo)", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(`${tmpdir()}/porcelain-seam-`);
    await runCommand(["git", "init", "-q", "."], { cwd: repoDir });
    await runCommand(["git", "config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await runCommand(["git", "config", "user.name", "Test"], { cwd: repoDir });
    await runCommand(["mkdir", "-p", "public", "src"], { cwd: repoDir });
    await Bun.write(`${repoDir}/public/img.png`, "original");
    await Bun.write(`${repoDir}/src/index.json`, "original");
    await runCommand(["git", "add", "public", "src"], { cwd: repoDir });
    await runCommand(["git", "commit", "-qm", "init"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("a single worktree-modified file keeps its first character", async () => {
    // The regression: git reports ` M src/index.json` and a whole-output trim
    // used to turn this into "rc/index.json".
    await Bun.write(`${repoDir}/src/index.json`, "changed");

    const files = await changedFilesInPaths(repoDir, ["public", "src"]);

    expect(files).toEqual(["src/index.json"]);
  });

  test("an equality guard against a known path matches", async () => {
    // Exactly the shape of scout-showcase-refresh's timestamp-only
    // suppression, which could never fire while the first path was mangled.
    const assetIndex = "src/index.json";
    await Bun.write(`${repoDir}/${assetIndex}`, "changed");

    const files = await changedFilesInPaths(repoDir, ["public", "src"]);

    expect(files.length === 1 && files[0] === assetIndex).toBe(true);
  });

  test("only the first line was ever affected, so multi-file listings prove it too", async () => {
    await Bun.write(`${repoDir}/public/img.png`, "changed");
    await Bun.write(`${repoDir}/src/index.json`, "changed");

    const files = await changedFilesInPaths(repoDir, ["public", "src"]);

    // git sorts by path, so public/ precedes src/ — the mangled one was first.
    expect(files).toEqual(["public/img.png", "src/index.json"]);
  });

  test("staged and untracked paths parse whole", async () => {
    await Bun.write(`${repoDir}/src/index.json`, "changed");
    await runCommand(["git", "add", "src/index.json"], { cwd: repoDir });
    await Bun.write(`${repoDir}/public/new.png`, "brand new");

    const files = await changedFilesInPaths(repoDir, ["public", "src"]);

    // git lists tracked changes first and untracked (`??`) entries last, so
    // this is NOT path-sorted overall.
    expect(files).toEqual(["src/index.json", "public/new.png"]);
  });

  test("a clean tree reports no changed files", async () => {
    expect(await changedFilesInPaths(repoDir, ["public", "src"])).toEqual([]);
  });

  test("a changelog-style membership check matches (season-refresh's guard)", async () => {
    // scout-season-refresh gates a prettier run on
    // `files.includes(CHANGELOG_FILE)`; when the changelog is the only dirty
    // file it was the mangled first entry and the guard silently missed.
    const changelog = "src/index.json";
    await Bun.write(`${repoDir}/${changelog}`, "changed");

    const files = await changedFilesInPaths(repoDir, ["public", "src"]);

    expect(files.includes(changelog)).toBe(true);
  });
});

// This guard exists because a bot force-push can DESTROY a human's commit, so
// it is driven against real repositories with a real remote rather than mocked
// git output. The bug it prevents is invisible to any test that stubs git:
// `openSeasonRefreshPr` builds its commit with `git checkout -B` from a fresh
// main clone, so the fetched `origin/<branch>` is never a base and
// `--force-with-lease` — which only proves the REF has not moved — happily
// replaces content it never saw.
/** Commit `file` in `dir` authored by `email`, without touching repo config. */
async function commitAs(
  dir: string,
  email: string,
  file: string,
  body: string,
): Promise<void> {
  await Bun.write(`${dir}/${file}`, body);
  await runCommand(["git", "add", "--", file], { cwd: dir });
  await runCommand(
    [
      "git",
      "-c",
      `user.email=${email}`,
      "-c",
      "user.name=X",
      "commit",
      "-qm",
      `edit ${file}`,
    ],
    { cwd: dir },
  );
}

describe("assertRemoteBranchIsOurs (real remote)", () => {
  const BOT = "ci@sjer.red";
  const BRANCH = "chore/proposal";
  let remoteDir: string;
  let repoDir: string;

  beforeEach(async () => {
    remoteDir = await mkdtemp(`${tmpdir()}/branch-guard-remote-`);
    await runCommand(["git", "init", "-q", "--bare", "."], { cwd: remoteDir });

    // A seed clone stands in for the previous run: it publishes main and the
    // bot's proposal branch.
    const seed = await mkdtemp(`${tmpdir()}/branch-guard-seed-`);
    await runCommand(["git", "clone", "-q", remoteDir, "."], { cwd: seed });
    await commitAs(seed, BOT, "catalog.json", "original");
    await runCommand(["git", "branch", "-M", "main"], { cwd: seed });
    await runCommand(["git", "push", "-q", "origin", "main"], { cwd: seed });
    await runCommand(["git", "checkout", "-qB", BRANCH], { cwd: seed });
    await commitAs(seed, BOT, "catalog.json", "bot proposal");
    await runCommand(["git", "push", "-q", "origin", BRANCH], { cwd: seed });
    await rm(seed, { recursive: true, force: true });

    // The bot's own working clone: main only, exactly as the activities clone it.
    repoDir = await mkdtemp(`${tmpdir()}/branch-guard-bot-`);
    await runCommand(
      [
        "git",
        "clone",
        "-q",
        "--branch",
        "main",
        "--single-branch",
        remoteDir,
        ".",
      ],
      { cwd: repoDir },
    );
    await runCommand(
      [
        "git",
        "fetch",
        "-q",
        "origin",
        `refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`,
      ],
      { cwd: repoDir },
    );
    await runCommand(["git", "checkout", "-qB", BRANCH], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  test("permits replacing the bot's own proposal, even with new content", async () => {
    // The common case, and the one a tree comparison would have broken: a
    // branch whose name is stable across runs legitimately carries different
    // content each time.
    await commitAs(repoDir, BOT, "catalog.json", "regenerated, different");

    await assertRemoteBranchIsOurs({ repoDir, branch: BRANCH });
  });

  test("permits an unchanged regeneration", async () => {
    await commitAs(repoDir, BOT, "catalog.json", "bot proposal");

    await assertRemoteBranchIsOurs({ repoDir, branch: BRANCH });
  });

  test("refuses when an operator has committed to the branch", async () => {
    // The real scenario: someone records an adjudication on the open PR.
    const operatorClone = await mkdtemp(`${tmpdir()}/branch-guard-op-`);
    await runCommand(
      [
        "git",
        "clone",
        "-q",
        "--branch",
        BRANCH,
        "--single-branch",
        remoteDir,
        ".",
      ],
      { cwd: operatorClone },
    );
    await commitAs(
      operatorClone,
      "jerred@sjer.red",
      "catalog.json",
      "human adjudication",
    );
    await runCommand(["git", "push", "-q", "origin", BRANCH], {
      cwd: operatorClone,
    });
    await rm(operatorClone, { recursive: true, force: true });

    // The bot re-fetches and regenerates, as the next scheduled run would.
    await runCommand(
      [
        "git",
        "fetch",
        "-q",
        "origin",
        `refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`,
        "--force",
      ],
      { cwd: repoDir },
    );
    await commitAs(repoDir, BOT, "catalog.json", "bot proposal");

    await expect(
      assertRemoteBranchIsOurs({ repoDir, branch: BRANCH }),
    ).rejects.toThrow(/jerred@sjer\.red/);
  });

  test("recognises itself when GIT_AUTHOR_EMAIL overrides the repo config", async () => {
    // AGENTS.md documents GIT_AUTHOR_EMAIL as the bot identity for activities
    // that commit, and the env var beats `git config user.email`. Comparing
    // against a hardcoded address would make the bot fail to recognise its own
    // commits and block every run forever.
    const deployBot = "deploy-bot@sjer.red";
    const seed = await mkdtemp(`${tmpdir()}/branch-guard-seed2-`);
    await runCommand(
      [
        "git",
        "clone",
        "-q",
        "--branch",
        BRANCH,
        "--single-branch",
        remoteDir,
        ".",
      ],
      { cwd: seed },
    );
    await commitAs(
      seed,
      deployBot,
      "catalog.json",
      "earlier run under env identity",
    );
    await runCommand(["git", "push", "-q", "origin", BRANCH], { cwd: seed });
    await rm(seed, { recursive: true, force: true });

    await runCommand(
      [
        "git",
        "fetch",
        "-q",
        "origin",
        `refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`,
        "--force",
      ],
      { cwd: repoDir },
    );
    await commitAs(
      repoDir,
      deployBot,
      "catalog.json",
      "this run, same identity",
    );

    await assertRemoteBranchIsOurs({ repoDir, branch: BRANCH });
  });
});
