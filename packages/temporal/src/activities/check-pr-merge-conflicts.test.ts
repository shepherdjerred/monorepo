import { afterEach, describe, expect, it } from "bun:test";
import {
  parseConflictPaths,
  runCheckPrMergeConflictsImpl,
  type CommitStatusState,
  type ConflictCheckClient,
  type ConflictCheckPullRef,
} from "./check-pr-merge-conflicts.ts";
import type { CheckPrMergeConflictsInput } from "#shared/schemas.ts";

const OWNER = "shepherdjerred";
const REPO = "monorepo";
const MAIN_SHA = "1".repeat(40);

type StatusCall = {
  sha: string;
  state: CommitStatusState;
  description: string;
  context: string;
};

function makeClient(prs: ConflictCheckPullRef[]): {
  client: ConflictCheckClient;
  statusCalls: StatusCall[];
} {
  const statusCalls: StatusCall[] = [];
  const client: ConflictCheckClient = {
    listOpenPrs: async () => prs,
    createCommitStatus: async (params) => {
      statusCalls.push({
        sha: params.sha,
        state: params.state,
        description: params.description,
        context: params.context,
      });
    },
  };
  return { client, statusCalls };
}

function pull(
  prNumber: number,
  headSha: string,
  options: { headRef?: string; baseRef?: string } = {},
): ConflictCheckPullRef {
  return {
    number: prNumber,
    head: {
      sha: headSha,
      ref: options.headRef ?? `feature/pr-${String(prNumber)}`,
    },
    base: { ref: options.baseRef ?? "main" },
  };
}

const TOKEN = {
  token: "stub-installation-token",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const STUB_WORKDIR = "/tmp/pr-merge-conflict-stub";

const noopCleanup = (): Promise<void> => Promise.resolve();

const stubPrepareWorkDir = async (): Promise<{
  workDir: string;
  cleanup: () => Promise<void>;
}> => {
  return { workDir: STUB_WORKDIR, cleanup: noopCleanup };
};

afterEach(() => {
  delete Bun.env["MERGE_CONFLICT_CHECK_ENABLED"];
  delete Bun.env["MERGE_CONFLICT_CHECK_DRY_RUN"];
});

describe("parseConflictPaths", () => {
  it("extracts unique paths from stage lines", () => {
    const stdout = [
      "6bf05687e77bc1e908b3e0ae4eaa3ad495a7f0e9",
      "100644 102c5dad3f2272fbada18190636fdfe7ae870555 1\tpkg/file.txt",
      "100644 e28fe29e3f53f07d2b0aa5a9fc92dff111061111 2\tpkg/file.txt",
      "100644 346d56082e8f2551af3a9c70d74e2b090c2b7c71 3\tpkg/file.txt",
      "100644 deadbeefdeadbeefdeadbeefdeadbeefdeadbeef 1\tother.txt",
      "100644 cafef00dcafef00dcafef00dcafef00dcafef00d 2\tother.txt",
      "100644 babababababababababababababababababababa 3\tother.txt",
      "Auto-merging pkg/file.txt",
      "CONFLICT (content): Merge conflict in pkg/file.txt",
    ].join("\n");
    expect(parseConflictPaths(stdout)).toEqual(["other.txt", "pkg/file.txt"]);
  });

  it("returns empty for a clean tree (single OID line)", () => {
    expect(
      parseConflictPaths("71bbcdfea9fefb1e862d2ac1180902ba76c59d7e\n"),
    ).toEqual([]);
  });
});

describe("runCheckPrMergeConflictsImpl (kill switch + dry run)", () => {
  it("no-ops when MERGE_CONFLICT_CHECK_ENABLED=false", async () => {
    Bun.env["MERGE_CONFLICT_CHECK_ENABLED"] = "false";
    const { client, statusCalls } = makeClient([]);
    const tokenCalls: string[] = [];
    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => {
          tokenCalls.push("called");
          return TOKEN;
        },
        createClient: () => client,
      },
    );
    expect(result.skippedKillSwitch).toBe(true);
    expect(result.prsChecked).toBe(0);
    expect(statusCalls).toHaveLength(0);
    // Kill switch hit BEFORE token minting — saves an unnecessary API call.
    expect(tokenCalls).toHaveLength(0);
  });

  it("does not post any commit status in dry-run mode", async () => {
    Bun.env["MERGE_CONFLICT_CHECK_DRY_RUN"] = "true";
    const { client, statusCalls } = makeClient([pull(1, "a".repeat(40))]);
    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => TOKEN,
        createClient: () => client,
        prepareWorkDir: stubPrepareWorkDir,
        runMergeBase: async () => "base-sha",
        runMergeTree: async () => ({
          exitCode: 0,
          stdout: "tree\n",
          stderr: "",
        }),
      },
    );
    expect(result.dryRun).toBe(true);
    expect(result.prsChecked).toBe(1);
    expect(statusCalls).toHaveLength(0);
  });
});

describe("runCheckPrMergeConflictsImpl (all-prs)", () => {
  it("posts success for a clean PR and failure for a conflicting PR", async () => {
    const cleanSha = "c".repeat(40);
    const conflictSha = "f".repeat(40);
    const { client, statusCalls } = makeClient([
      pull(101, cleanSha),
      pull(202, conflictSha),
    ]);

    const conflictStdout = [
      "treeoidtreeoidtreeoidtreeoidtreeoidtreeoid",
      "100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1\tsrc/foo.ts",
      "100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2\tsrc/foo.ts",
      "100644 cccccccccccccccccccccccccccccccccccccccc 3\tsrc/foo.ts",
      "CONFLICT (content): Merge conflict in src/foo.ts",
    ].join("\n");

    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => TOKEN,
        createClient: () => client,
        prepareWorkDir: stubPrepareWorkDir,
        runMergeBase: async () => "base-sha",
        runMergeTree: async (_dir, _base, prNumber) =>
          prNumber === 101
            ? {
                exitCode: 0,
                stdout: "treeoidcleancleancleanclean\n",
                stderr: "",
              }
            : { exitCode: 1, stdout: conflictStdout, stderr: "" },
      },
    );

    expect(result.prsChecked).toBe(2);
    expect(result.clean).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.errored).toBe(0);

    const byShas = new Map(statusCalls.map((c) => [c.sha, c]));
    const clean = byShas.get(cleanSha);
    const conflict = byShas.get(conflictSha);
    expect(clean).toBeDefined();
    expect(conflict).toBeDefined();
    if (clean === undefined || conflict === undefined) {
      throw new Error("expected both statuses");
    }
    expect(clean.context).toBe("ci/merge-conflict");
    expect(clean.state).toBe("success");
    expect(clean.description).toContain("Clean merge");
    expect(conflict.state).toBe("failure");
    expect(conflict.description).toContain("Conflicts with main");
    expect(conflict.description).toContain("1 file(s)");
  });

  it("captures per-PR errors without aborting the whole activity", async () => {
    const okSha = "1".repeat(40);
    const badSha = "2".repeat(40);
    const { client, statusCalls } = makeClient([
      pull(301, okSha),
      pull(302, badSha),
    ]);

    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => TOKEN,
        createClient: () => client,
        prepareWorkDir: stubPrepareWorkDir,
        runMergeBase: async (_dir, prNumber) => {
          if (prNumber === 302) {
            throw new Error(
              "fatal: Not a valid object name refs/pull/302/head",
            );
          }
          return "base-sha";
        },
        runMergeTree: async () => ({
          exitCode: 0,
          stdout: "treeoid\n",
          stderr: "",
        }),
      },
    );

    expect(result.prsChecked).toBe(2);
    expect(result.clean).toBe(1);
    expect(result.errored).toBe(1);
    // Only the good PR got a status posted; the errored one is skipped.
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.sha).toBe(okSha);
  });

  it("treats merge-tree exit codes >1 as activity errors per PR", async () => {
    const sha = "9".repeat(40);
    const { client, statusCalls } = makeClient([pull(401, sha)]);

    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => TOKEN,
        createClient: () => client,
        prepareWorkDir: stubPrepareWorkDir,
        runMergeBase: async () => "base-sha",
        runMergeTree: async () => ({
          exitCode: 128,
          stdout: "",
          stderr: "fatal: bad object",
        }),
      },
    );

    expect(result.errored).toBe(1);
    expect(statusCalls).toHaveLength(0);
  });

  it("returns early when there are zero open PRs targeting main", async () => {
    const { client, statusCalls } = makeClient([]);
    const result = await runCheckPrMergeConflictsImpl(
      { kind: "all-prs", owner: OWNER, repo: REPO, mainSha: MAIN_SHA },
      {
        createInstallationToken: async () => TOKEN,
        createClient: () => client,
        // prepareWorkDir intentionally omitted — must not be invoked.
      },
    );
    expect(result.prsChecked).toBe(0);
    expect(statusCalls).toHaveLength(0);
  });
});

describe("runCheckPrMergeConflictsImpl (single-pr)", () => {
  it("posts a single status for the targeted PR", async () => {
    const headSha = "d".repeat(40);
    const input: CheckPrMergeConflictsInput = {
      kind: "single-pr",
      owner: OWNER,
      repo: REPO,
      prNumber: 777,
      headSha,
      baseRef: "main",
    };
    const { client, statusCalls } = makeClient([]);
    const result = await runCheckPrMergeConflictsImpl(input, {
      createInstallationToken: async () => TOKEN,
      createClient: () => client,
      prepareWorkDir: stubPrepareWorkDir,
      runMergeBase: async () => "base-sha",
      runMergeTree: async () => ({
        exitCode: 0,
        stdout: "treeoid\n",
        stderr: "",
      }),
    });
    expect(result.prsChecked).toBe(1);
    expect(result.clean).toBe(1);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.sha).toBe(headSha);
    expect(statusCalls[0]?.state).toBe("success");
  });

  it("skips PRs targeting a non-main base", async () => {
    const input: CheckPrMergeConflictsInput = {
      kind: "single-pr",
      owner: OWNER,
      repo: REPO,
      prNumber: 999,
      headSha: "e".repeat(40),
      baseRef: "gh-pages",
    };
    const { client, statusCalls } = makeClient([]);
    let prepareCalled = false;
    const result = await runCheckPrMergeConflictsImpl(input, {
      createInstallationToken: async () => TOKEN,
      createClient: () => client,
      prepareWorkDir: async () => {
        prepareCalled = true;
        return stubPrepareWorkDir();
      },
    });
    expect(result.prsChecked).toBe(0);
    expect(statusCalls).toHaveLength(0);
    // We did mint a token (the early-return is inside the kind branch) but the
    // work directory was never prepared — git ops are skipped entirely.
    expect(prepareCalled).toBe(false);
  });
});
