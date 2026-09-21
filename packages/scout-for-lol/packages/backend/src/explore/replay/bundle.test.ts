import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, mkdir, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ReplayCaseIndexEntrySchema,
  ReplayManifestSchema,
  appendBundleLine,
  bundleLocationIssues,
  bundlePaths,
  completedCaseIds,
  createBundleDirectory,
  isInsideGitCheckout,
  recordedCaseEntries,
  runIdIssues,
  replayBundleRoot,
  writeBundleFile,
} from "./bundle.ts";

const temporaries: string[] = [];

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "explore-replay-test-"));
  temporaries.push(dir);
  return dir;
}

afterEach(async () => {
  while (temporaries.length > 0) {
    const dir = temporaries.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

describe("replayBundleRoot", () => {
  test("honours XDG_STATE_HOME", () => {
    expect(replayBundleRoot({ XDG_STATE_HOME: "/state" })).toBe(
      "/state/scout-for-lol/explore-replay",
    );
  });

  test("falls back to ~/.local/state", () => {
    expect(replayBundleRoot({})).toContain(
      path.join(".local", "state", "scout-for-lol", "explore-replay"),
    );
  });
});

describe("isInsideGitCheckout", () => {
  test("detects a checkout at the directory itself", async () => {
    const dir = await temporaryDir();
    await mkdir(path.join(dir, ".git"));
    expect(await isInsideGitCheckout(dir)).toBe(true);
  });

  test("detects a checkout above the directory", async () => {
    const dir = await temporaryDir();
    await mkdir(path.join(dir, ".git"));
    const nested = path.join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    expect(await isInsideGitCheckout(nested)).toBe(true);
  });

  test("detects a linked worktree, whose .git is a file", async () => {
    // The form this repository is developed in: `.git` is a file holding a
    // `gitdir:` pointer, not a directory. An earlier version of this test
    // created a directory and so passed without covering the case.
    const dir = await temporaryDir();
    await Bun.write(
      path.join(dir, ".git"),
      "gitdir: /Users/someone/git/repo/.git/worktrees/feature\n",
    );
    expect(await isInsideGitCheckout(dir)).toBe(true);
  });

  test("detects a linked worktree above the directory", async () => {
    const dir = await temporaryDir();
    await Bun.write(
      path.join(dir, ".git"),
      "gitdir: /Users/someone/git/repo/.git/worktrees/feature\n",
    );
    const nested = path.join(dir, "packages", "state");
    await mkdir(nested, { recursive: true });
    expect(await isInsideGitCheckout(nested)).toBe(true);
  });

  test("accepts a directory with no checkout above it", async () => {
    const dir = await temporaryDir();
    const nested = path.join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    expect(await isInsideGitCheckout(nested)).toBe(false);
  });
});

describe("bundleLocationIssues", () => {
  test("accepts a 0700 directory outside any checkout", async () => {
    const parent = await temporaryDir();
    const dir = path.join(parent, "run-1");
    await createBundleDirectory(dir);
    expect(await bundleLocationIssues(dir)).toEqual([]);
  });

  test("rejects a directory that is group or world readable", async () => {
    const parent = await temporaryDir();
    const dir = path.join(parent, "run-1");
    await createBundleDirectory(dir);
    await chmod(dir, 0o755);
    const issues = await bundleLocationIssues(dir);
    expect(issues).toEqual([expect.stringContaining("has mode 755")]);
  });

  test("rejects a file inside the bundle that is not 0600", async () => {
    const parent = await temporaryDir();
    const dir = path.join(parent, "run-1");
    await createBundleDirectory(dir);
    const filePath = path.join(dir, "manifest.json");
    await writeBundleFile(filePath, "{}");
    await chmod(filePath, 0o644);
    const issues = await bundleLocationIssues(dir);
    expect(issues).toEqual([expect.stringContaining("has mode 644")]);
  });

  test("rejects a location inside a git checkout", async () => {
    const parent = await temporaryDir();
    await mkdir(path.join(parent, ".git"));
    const dir = path.join(parent, "run-1");
    await createBundleDirectory(dir);
    const issues = await bundleLocationIssues(dir);
    expect(issues).toEqual([expect.stringContaining("inside a git checkout")]);
  });

  test("reports a missing directory rather than pretending it is fine", async () => {
    const parent = await temporaryDir();
    const issues = await bundleLocationIssues(path.join(parent, "absent"));
    expect(issues).toEqual([expect.stringContaining("does not exist")]);
  });
});

describe("createBundleDirectory and writeBundleFile", () => {
  test("create 0700 directories and 0600 files regardless of umask", async () => {
    const parent = await temporaryDir();
    const dir = path.join(parent, "run-1");
    await createBundleDirectory(dir);
    const dirStat = await stat(dir);
    expect(dirStat.mode & 0o777).toBe(0o700);
    const filePath = path.join(dir, "summary.json");
    await writeBundleFile(filePath, "{}");
    const fileStat = await stat(filePath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });
});

describe("appendBundleLine", () => {
  test("keeps every line when writers finish at the same moment", async () => {
    // Cases run four at a time. A read-then-rewrite append loses entries here,
    // and a lost entry means `--resume` pays to run a case whose result file
    // already exists.
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    const lines = Array.from({ length: 24 }, (_, index) =>
      JSON.stringify({ caseId: `chip:${index.toString()}` }),
    );
    await Promise.all(lines.map((line) => appendBundleLine(indexPath, line)));
    const indexText = await Bun.file(indexPath).text();
    const written = indexText.split("\n").filter((line) => line.trim() !== "");
    expect(written).toHaveLength(lines.length);
    expect(new Set(written)).toEqual(new Set(lines));
  });
});

describe("recordedCaseEntries", () => {
  test("is empty when no index exists yet", async () => {
    const dir = await temporaryDir();
    expect(await recordedCaseEntries(path.join(dir, "cases.jsonl"))).toEqual(
      [],
    );
  });

  test("keeps the signals of cases a resume will skip", async () => {
    // The reason this exists: a resumed run derives its verdict from the whole
    // index, so a clean remainder cannot certify a run whose earlier half
    // errored.
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(
      indexPath,
      JSON.stringify(
        ReplayCaseIndexEntrySchema.parse({
          caseId: "chip:aaa",
          kind: "chip",
          status: "error",
          durationMs: 10,
          signals: ["new_turn_errored"],
        }),
      ),
    );
    await appendBundleLine(
      indexPath,
      JSON.stringify(
        ReplayCaseIndexEntrySchema.parse({
          caseId: "conv:bbb:1",
          kind: "conversation",
          status: "ok",
          durationMs: 20,
          signals: [],
        }),
      ),
    );
    const entries = await recordedCaseEntries(indexPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.signals).toEqual(["new_turn_errored"]);
    expect(entries[1]?.kind).toBe("conversation");
  });

  test("refuses a final line that parses but is not a valid entry", async () => {
    // A whole line with a bad shape is damage, not an interrupted append; only
    // a byte-truncated line is recoverable, and that fails JSON parsing.
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(
      indexPath,
      JSON.stringify({
        caseId: "chip:aaa",
        kind: "chip",
        status: "ok",
        durationMs: 10,
        signals: ["not_a_real_signal"],
      }),
    );
    await expect(recordedCaseEntries(indexPath)).rejects.toThrow(
      /not a valid case entry/,
    );
  });

  test("refuses a malformed line that is not the last one", async () => {
    // Only the tail can be partial. Damage anywhere else would re-run a case
    // at live-model cost and lose whatever integrity failure it recorded.
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(indexPath, '{"caseId":"chip:aa');
    await appendBundleLine(
      indexPath,
      JSON.stringify(
        ReplayCaseIndexEntrySchema.parse({
          caseId: "chip:bbb",
          kind: "chip",
          status: "ok",
          durationMs: 10,
          signals: [],
        }),
      ),
    );
    await expect(recordedCaseEntries(indexPath)).rejects.toThrow(
      /line 1 is not valid JSON/,
    );
  });

  test("skips a truncated final line, as an interrupted run leaves", async () => {
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(
      indexPath,
      JSON.stringify(
        ReplayCaseIndexEntrySchema.parse({
          caseId: "chip:aaa",
          kind: "chip",
          status: "ok",
          durationMs: 10,
          signals: [],
        }),
      ),
    );
    await appendBundleLine(indexPath, '{"caseId":"chip:bb');
    const entries = await recordedCaseEntries(indexPath);
    expect(entries.map((entry) => entry.caseId)).toEqual(["chip:aaa"]);
  });
});

describe("completedCaseIds", () => {
  test("is empty when no index exists yet", async () => {
    const dir = await temporaryDir();
    const ids = await completedCaseIds(path.join(dir, "cases.jsonl"));
    expect(ids.size).toBe(0);
  });

  test("reads back the ids an interrupted run finished", async () => {
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    for (const caseId of ["chip:aaa", "chip:bbb"]) {
      await appendBundleLine(
        indexPath,
        JSON.stringify(
          ReplayCaseIndexEntrySchema.parse({
            caseId,
            kind: "chip",
            status: "ok",
            durationMs: 10,
            signals: [],
          }),
        ),
      );
    }
    const ids = await completedCaseIds(indexPath);
    expect([...ids].sort()).toEqual(["chip:aaa", "chip:bbb"]);
  });

  test("ignores a truncated final line so its case runs again", async () => {
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(
      indexPath,
      JSON.stringify(
        ReplayCaseIndexEntrySchema.parse({
          caseId: "chip:aaa",
          kind: "chip",
          status: "ok",
          durationMs: 10,
          signals: [],
        }),
      ),
    );
    await writeBundleFile(
      indexPath,
      `${await Bun.file(indexPath).text()}{"caseId":"chip:bb`,
    );
    const ids = await completedCaseIds(indexPath);
    expect([...ids]).toEqual(["chip:aaa"]);
  });

  test("refuses a well-formed line that is not a valid entry", async () => {
    // It was written whole, so a shape the schema rejects is damage. Ignoring
    // it would re-run the case and lose the integrity failure it recorded.
    const dir = await temporaryDir();
    const indexPath = path.join(dir, "cases.jsonl");
    await appendBundleLine(indexPath, JSON.stringify({ caseId: "chip:aaa" }));
    await expect(completedCaseIds(indexPath)).rejects.toThrow(
      /not a valid case entry/,
    );
  });
});

describe("runIdIssues", () => {
  test("accepts the ids this harness mints", () => {
    expect(runIdIssues("beta-mine-2026-09-20T19-41-07-298Z")).toEqual([]);
  });

  test("refuses a traversal, which would escape the bundle root", () => {
    // The directory is created and chmodded before any manifest is read, so a
    // traversing --resume would mutate somewhere else entirely.
    expect(runIdIssues("../../somewhere")).not.toEqual([]);
    expect(runIdIssues("..")).not.toEqual([]);
  });

  test("refuses a path separator or an empty id", () => {
    expect(runIdIssues("nested/run")).not.toEqual([]);
    expect(runIdIssues("")).not.toEqual([]);
  });
});

describe("bundlePaths", () => {
  test("keeps a case id recoverable in its filename", () => {
    const paths = bundlePaths("/runs/run-1");
    expect(paths.caseFile("chip:abc123")).toBe(
      "/runs/run-1/cases/chip_abc123.json",
    );
  });
});

describe("ReplayManifestSchema", () => {
  test("rejects unknown fields", () => {
    const manifest = {
      schemaVersion: 1,
      runId: "run-1",
      startedAt: "2026-09-19T00:00:00.000Z",
      stage: "beta",
      profile: "full",
      guildId: "1337623164146155593",
      expectedCapabilities: { bucks: true },
      lake: { buildId: "b1", puuidRemapFingerprint: "none" },
      database: { name: "scout_beta_snapshot", snapshotId: "1326601" },
      model: "gpt-5.6-luna",
      chipCatalogSha256: "a".repeat(64),
      corpusSha256: null,
      corpusVersion: null,
      promptSha256: "b".repeat(64),
      flagOverrides: [{ flag: "betting_enabled", value: true }],
      tokenBudgets: { hourly: 1, daily: 2 },
      gitCommit: "abc",
      concurrency: 1,
      caseCount: 3,
      baselineRunId: null,
    };
    expect(() => ReplayManifestSchema.parse(manifest)).not.toThrow();
    expect(() =>
      ReplayManifestSchema.parse({ ...manifest, extra: 1 }),
    ).toThrow();
  });
});
