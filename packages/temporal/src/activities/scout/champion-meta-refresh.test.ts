import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  SNAPSHOT_V2_GUARD_HINT,
  SNAPSHOT_V2_GUARD_MARKER,
} from "@scout-for-lol/data/meta/snapshot-v2-budget.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import {
  CHAMPION_META_SNAPSHOT_PATH,
  CHAMPION_META_SNAPSHOT_V2_DIRECTORY,
  ChampionMetaWorkflowInputSchema,
  SNAPSHOT_GUARD_MARKER,
  championMetaBranchName,
  championMetaContentHash,
  refuseRetryOfGuard,
  singleFilePaths,
  summarizeChangedFiles,
} from "./champion-meta-refresh.ts";
import { changedAllowedFiles } from "./generated-refresh.ts";

const V2 = CHAMPION_META_SNAPSHOT_V2_DIRECTORY;

describe("champion-meta refresh", () => {
  test("names the branch from the content hash", () => {
    expect(championMetaBranchName("0123456789ab")).toBe(
      "chore/scout-champion-meta-0123456789ab",
    );
  });

  test("requires an origin URL", () => {
    expect(() =>
      ChampionMetaWorkflowInputSchema.parse({ metaOrigin: "nope" }),
    ).toThrow();
  });

  test("the v2 directory is the one the Scout frontend writes", () => {
    expect(V2).toBe(
      "packages/scout-for-lol/packages/frontend/src/data/generated/champion-meta",
    );
  });
});

describe("changed file reporting", () => {
  const changed = [
    CHAMPION_META_SNAPSHOT_PATH,
    `${V2}/index.json`,
    `${V2}/a/b.json`,
  ];

  test("only the single file goes through the formatter gates", () => {
    expect(singleFilePaths(changed)).toEqual([CHAMPION_META_SNAPSHOT_PATH]);
    expect(singleFilePaths([`${V2}-other/x.json`])).toEqual([
      `${V2}-other/x.json`,
    ]);
  });

  test("the result summarizes the split snapshot as one line with a count", () => {
    expect(summarizeChangedFiles(changed)).toEqual([
      CHAMPION_META_SNAPSHOT_PATH,
      `${V2}/ (2 files)`,
    ]);
    expect(summarizeChangedFiles([CHAMPION_META_SNAPSHOT_PATH])).toEqual([
      CHAMPION_META_SNAPSHOT_PATH,
    ]);
  });
});

describe("the snapshot guard", () => {
  test("is the marker the Scout data package puts in every guard error", () => {
    expect(SNAPSHOT_GUARD_MARKER).toBe(SNAPSHOT_V2_GUARD_MARKER);
  });

  test("is not retried, and keeps the message naming AI-1031 and plan (b)", () => {
    const guard = new Error(
      `Command failed (bun run refresh-champion-meta): exit 1 ${SNAPSHOT_GUARD_MARKER}: ${SNAPSHOT_V2_GUARD_HINT}`,
    );
    let thrown: unknown;
    try {
      refuseRetryOfGuard(guard);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    if (!(thrown instanceof ApplicationFailure))
      throw new TypeError("not an ApplicationFailure");
    expect(thrown.nonRetryable).toBe(true);
    expect(thrown.type).toBe("ChampionMetaSnapshotGuard");
    expect(thrown.message).toMatch(/AI-1031 plan \(b\)/u);
  });

  test("passes any other failure through unchanged, so it can be retried", () => {
    const other = new Error("Meta API https://x answered 500");
    expect(() => {
      refuseRetryOfGuard(other);
    }).toThrow(other);
  });
});

describe("with a scratch clone", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), "champion-meta-refresh-"));
    await runCommand(["git", "init", "--quiet"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  async function write(relative: string, content: string): Promise<void> {
    const target = path.join(repoDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(target, content);
  }

  async function allowlisted(): Promise<string[]> {
    return await changedAllowedFiles(
      repoDir,
      [CHAMPION_META_SNAPSHOT_PATH],
      "Champion-meta refresh",
      [V2],
    );
  }

  test("allows the single file and every file below the v2 directory, listed one by one", async () => {
    await write(CHAMPION_META_SNAPSHOT_PATH, "{}\n");
    await write(`${V2}/index.json`, "{}\n");
    await write(`${V2}/champions/ahri.json`, "{}\n");
    await write(`${V2}/matchups/ahri/middle/zed.json`, "{}\n");
    expect(await allowlisted()).toEqual([
      CHAMPION_META_SNAPSHOT_PATH,
      `${V2}/champions/ahri.json`,
      `${V2}/index.json`,
      `${V2}/matchups/ahri/middle/zed.json`,
    ]);
  });

  test("refuses a path outside both, even beside the directory", async () => {
    await write(`${V2}/index.json`, "{}\n");
    await write(`${V2}-extra/index.json`, "{}\n");
    await write("packages/scout-for-lol/README.md", "x\n");
    const refused = allowlisted();
    await expect(refused).rejects.toThrow(
      /disallowed paths: packages\/scout-for-lol\/README\.md, /u,
    );
    await expect(refused).rejects.toThrow(/champion-meta-extra\/index\.json/u);
    // The allowed v2 file is not named among the refused paths.
    await expect(refused).rejects.not.toThrow(/champion-meta\/index\.json/u);
  });

  test("without a directory, an untracked tree is a single refused entry, as before", async () => {
    await write(`${V2}/index.json`, "{}\n");
    await expect(
      changedAllowedFiles(
        repoDir,
        [CHAMPION_META_SNAPSHOT_PATH],
        "Champion-meta refresh",
      ),
    ).rejects.toThrow(/disallowed paths/u);
  });

  test("hashes the single file and every v2 file, in a fixed order", async () => {
    await write(CHAMPION_META_SNAPSHOT_PATH, "{}\n");
    await write(`${V2}/index.json`, "1\n");
    await write(`${V2}/matchups/a/top/b.json`, "2\n");
    const first = await championMetaContentHash(repoDir);
    expect(await championMetaContentHash(repoDir)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{12}$/u);

    await write(`${V2}/matchups/a/top/b.json`, "3\n");
    const changed = await championMetaContentHash(repoDir);
    expect(changed).not.toBe(first);

    await write(`${V2}/matchups/a/top/c.json`, "4\n");
    expect(await championMetaContentHash(repoDir)).not.toBe(changed);
  });
});
