import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeSeasonRefreshPr,
  isGeneratedAtOnlyDiff,
  refreshSeasonRefreshPrMetadata,
  revertGeneratedAtOnlyChanges,
  runCommand,
  type GitCommandRunner,
} from "./scout-season-refresh-git.ts";
import { gitProcessEnvironment } from "#lib/pr-review-workdir.ts";

const TIMESTAMP_ONLY_DIFF = [
  "diff --git a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "index 1234567..89abcde 100644",
  "--- a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "+++ b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "@@ -2,3 +2,3 @@",
  '   "version": 1,',
  '-  "generatedAt": "2026-06-20T02:58:45.303Z",',
  '+  "generatedAt": "2026-07-19T12:00:00.000Z",',
  '   "assets": [',
].join("\n");

const MIXED_DIFF = [
  "--- a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "+++ b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  '-  "generatedAt": "2026-06-20T02:58:45.303Z",',
  '+  "generatedAt": "2026-07-19T12:00:00.000Z",',
  '-      "byteLength": 100,',
  '+      "byteLength": 200,',
].join("\n");

describe("isGeneratedAtOnlyDiff", () => {
  test("true for a generatedAt-only diff", () => {
    expect(isGeneratedAtOnlyDiff(TIMESTAMP_ONLY_DIFF)).toBe(true);
  });

  test("false when other lines changed too", () => {
    expect(isGeneratedAtOnlyDiff(MIXED_DIFF)).toBe(false);
  });

  test("false for an empty diff (no changed lines = not a timestamp diff)", () => {
    expect(isGeneratedAtOnlyDiff("")).toBe(false);
  });

  // The lane-prior artifacts are the second consumer of this helper, and their
  // stamp sits inside a nested object rather than at the top level.
  test("true for a lane-prior artifact whose only change is its stamp", () => {
    const diff = [
      "--- a/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
      "+++ b/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
      '   "artifactVersion": 1,',
      '-  "generatedAt": "2026-05-16T20:00:21.251Z",',
      '+  "generatedAt": "2026-08-14T13:05:00.000Z",',
    ].join("\n");
    expect(isGeneratedAtOnlyDiff(diff)).toBe(true);
  });

  test("false when a lane-prior probability moved alongside the stamp", () => {
    const diff = [
      "--- a/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
      "+++ b/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
      '-  "generatedAt": "2026-05-16T20:00:21.251Z",',
      '+  "generatedAt": "2026-08-14T13:05:00.000Z",',
      '-      "matchCount": 621,',
      '+      "matchCount": 640,',
    ].join("\n");
    expect(isGeneratedAtOnlyDiff(diff)).toBe(false);
  });
});

const ARTIFACT = "packages/scout-for-lol/packages/data/a.generated.json";
const REPORT = "packages/scout-for-lol/packages/data/b.generated.json";

function stampOnlyDiff(artifactPath: string): string {
  return [
    `--- a/${artifactPath}`,
    `+++ b/${artifactPath}`,
    '-  "generatedAt": "2026-05-16T20:00:21.251Z",',
    '+  "generatedAt": "2026-08-14T13:05:00.000Z",',
  ].join("\n");
}

function realDiff(artifactPath: string): string {
  return [
    `--- a/${artifactPath}`,
    `+++ b/${artifactPath}`,
    '-  "matchCount": 621,',
    '+  "matchCount": 640,',
  ].join("\n");
}

/**
 * `revertGeneratedAtOnlyChanges` uses the module's own `runCommand`, so these
 * drive it through a temp git repo rather than a stub — which also proves the
 * `git checkout --` actually restores the file.
 */
const repositories: string[] = [];
let restoreGitEnv: (() => void) | undefined;

beforeAll(() => {
  // The code under test spawns git through its own runCommand, which inherits
  // this process's environment — so the isolation has to be applied here, not
  // just to the setup commands. Without it these tests read the operator's
  // ~/.gitconfig: an ~/.gitignore git cannot expand aborts `git status`, and
  // commit.gpgsign or core.hooksPath change what a seed commit even does.
  // Reuse the isolation production already applies to its own git calls
  // (gitProcessEnvironment), so the tests exercise the same contract rather
  // than a second definition that can drift from it.
  const hermetic = gitProcessEnvironment({});
  const managed = [
    "HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_TERMINAL_PROMPT",
  ];
  const previous = new Map(managed.map((key) => [key, Bun.env[key]]));
  for (const key of managed) {
    const value = hermetic[key];
    if (value !== undefined) Bun.env[key] = value;
  }
  restoreGitEnv = () => {
    for (const [key, value] of previous) {
      // Assigning undefined would store the literal string "undefined".
      if (value === undefined) Reflect.deleteProperty(Bun.env, key);
      else Bun.env[key] = value;
    }
  };
});

afterAll(() => {
  restoreGitEnv?.();
});

// Cleanup belongs here rather than at the end of each test body: a failing
// assertion aborts the body, so an in-body cleanup leaks the directory on
// exactly the runs worth re-running.
afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function withRepo(
  contents: Record<string, string>,
  edits: Record<string, string>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "revert-stamp-"));
  repositories.push(dir);
  await runCommand(["git", "init", "-q"], { cwd: dir });
  await runCommand(["git", "config", "user.email", "t@example.com"], {
    cwd: dir,
  });
  await runCommand(["git", "config", "user.name", "T"], { cwd: dir });
  for (const [filePath, body] of Object.entries(contents)) {
    await Bun.write(`${dir}/${filePath}`, body);
  }
  await runCommand(["git", "add", "--", ...Object.keys(contents)], {
    cwd: dir,
  });
  await runCommand(["git", "commit", "-qm", "seed"], { cwd: dir });
  for (const [filePath, body] of Object.entries(edits)) {
    await Bun.write(`${dir}/${filePath}`, body);
  }
  return dir;
}

describe("revertGeneratedAtOnlyChanges", () => {
  test("reverts a stamp-only change and leaves a real change alone", async () => {
    const seed = {
      [ARTIFACT]:
        '{\n  "generatedAt": "2026-05-16T20:00:21.251Z",\n  "matchCount": 621\n}\n',
      [REPORT]:
        '{\n  "generatedAt": "2026-05-16T20:00:21.251Z",\n  "accuracy": 0.97\n}\n',
    };
    const dir = await withRepo(seed, {
      // stamp-only
      [ARTIFACT]:
        '{\n  "generatedAt": "2026-08-14T13:05:00.000Z",\n  "matchCount": 621\n}\n',
      // stamp AND a real value
      [REPORT]:
        '{\n  "generatedAt": "2026-08-14T13:05:00.000Z",\n  "accuracy": 0.91\n}\n',
    });

    const reverted = await revertGeneratedAtOnlyChanges(dir, [
      ARTIFACT,
      REPORT,
    ]);

    expect(reverted).toEqual([ARTIFACT]);

    const status = await runCommand(["git", "status", "--porcelain"], {
      cwd: dir,
      trimStdout: false,
    });
    expect(status).not.toContain(ARTIFACT);
    expect(status).toContain(REPORT);
  });

  test("is a no-op when nothing changed", async () => {
    const seed = {
      [ARTIFACT]: '{\n  "generatedAt": "2026-05-16T20:00:21.251Z"\n}\n',
    };
    const dir = await withRepo(seed, {});

    expect(await revertGeneratedAtOnlyChanges(dir, [ARTIFACT])).toEqual([]);
  });

  test("diffs each path separately so one real change cannot mask another's churn", () => {
    // The property the per-path loop exists for, asserted on the pure helper:
    // concatenating the two diffs would read as "not stamp-only" overall.
    expect(isGeneratedAtOnlyDiff(stampOnlyDiff(ARTIFACT))).toBe(true);
    expect(isGeneratedAtOnlyDiff(realDiff(REPORT))).toBe(false);
    expect(
      isGeneratedAtOnlyDiff(`${stampOnlyDiff(ARTIFACT)}\n${realDiff(REPORT)}`),
    ).toBe(false);
  });
});

describe("shared proposal PR reconciliation", () => {
  test("reports a safe operation label when command output is redacted", async () => {
    await expect(
      runCommand(
        [
          "bun",
          "-e",
          'console.error("credential-shaped-secret"); process.exit(7)',
        ],
        {
          cwd: "/tmp",
          redactOutput: true,
          operation: "branch-push",
        },
      ),
    ).rejects.toThrow("Command failed (branch-push): exit 7 <redacted>");
  });

  test("refreshes the title and body of a reused PR", async () => {
    const calls: string[][] = [];
    const commandRunner: GitCommandRunner = (command) => {
      calls.push(command);
      return Promise.resolve("");
    };

    await refreshSeasonRefreshPrMetadata(
      {
        repoDir: "/tmp/repo",
        ghToken: "token",
        repoSlug: "owner/repo",
        title: "new title",
        body: "new body",
      },
      "https://github.com/owner/repo/pull/1",
      commandRunner,
    );

    expect(calls).toEqual([
      [
        "gh",
        "pr",
        "edit",
        "https://github.com/owner/repo/pull/1",
        "--repo",
        "owner/repo",
        "--title",
        "new title",
        "--body",
        "new body",
      ],
    ]);
  });

  test("closes and deletes an obsolete shared proposal branch", async () => {
    const calls: string[][] = [];
    const responses = ["https://github.com/owner/repo/pull/1", ""];
    const commandRunner: GitCommandRunner = (command) => {
      calls.push(command);
      return Promise.resolve(responses.shift() ?? "");
    };

    const closedPr = await closeSeasonRefreshPr(
      {
        repoDir: "/tmp/repo",
        branch: "chore/scout-queue-windows",
        ghToken: "token",
        repoSlug: "owner/repo",
        reason: "Fresh evidence removed the drift.",
      },
      commandRunner,
    );

    expect(closedPr).toBe("https://github.com/owner/repo/pull/1");
    expect(calls).toEqual([
      [
        "gh",
        "pr",
        "list",
        "--repo",
        "owner/repo",
        "--head",
        "chore/scout-queue-windows",
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        '.[0].url // ""',
      ],
      [
        "gh",
        "pr",
        "close",
        "https://github.com/owner/repo/pull/1",
        "--repo",
        "owner/repo",
        "--comment",
        "Fresh evidence removed the drift.",
        "--delete-branch",
      ],
    ]);
  });
});
