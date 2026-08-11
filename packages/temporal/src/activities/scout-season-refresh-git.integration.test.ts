import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { changedFilesInPaths, runCommand } from "./scout-season-refresh-git.ts";

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
