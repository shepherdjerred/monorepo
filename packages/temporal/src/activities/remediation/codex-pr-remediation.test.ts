import type { ApplicationFailure } from "@temporalio/common";
import { describe, expect, test, vi } from "vitest";
import type {
  AgentTurnOutcome,
  RunCodexAgentTurnInput,
} from "#lib/agent-runner/contract.ts";
import { AgentTurnExecutionError } from "#lib/agent-runner/errors.ts";
import {
  REMEDIATION_DISABLED_SUMMARY,
  runCodexPrRemediation,
  type CodexPrRemediationDependencies,
} from "./codex-pr-remediation.ts";
import { remediationBranchName } from "./codex-pr-remediation-git.ts";
import { createRemediationTestGitRepo } from "./remediation-test-git.ts";

function fakeAgentOutcome(
  finalText = "Updated target files.",
): AgentTurnOutcome {
  return {
    finalText,
    evidenceEvents: [],
    sessionId: "session-1",
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 10,
    },
    numTurns: 2,
    generationStarted: true,
    possiblyAppliedEffects: true,
    durationMs: 500,
    eventCount: 4,
    firstEventLatencyMs: 50,
    maxIdleMs: 100,
  };
}

function createLocalGitRepo() {
  return createRemediationTestGitRepo({
    prefix: "remediation-test-",
    repoSubdir: "monorepo",
    files: {
      "README.md": "# Hello\nOld link\n",
      "OTHER.md": "# Other\nOriginal\n",
      "AGENTS.md": "# Agents\nDo not touch\n",
    },
  });
}

function baseLocalRepoDeps(repo: {
  tempDir: string;
  repoDir: string;
}): CodexPrRemediationDependencies {
  return {
    isRemediationEnabled: () => Promise.resolve(true),
    env: { OPENAI_API_KEY: "dummy-openai-value" },
    createWorkspace: () =>
      Promise.resolve({
        tempDir: repo.tempDir,
        repoDir: repo.repoDir,
        cleanup: () => Promise.resolve(),
      }),
    cloneRepo: () => Promise.resolve(),
  };
}

describe("runCodexPrRemediation", () => {
  test("skips immediately without cloning or invoking Codex when feature flag is false", async () => {
    const cloneRepo = vi.fn();
    const runAgentTurn = vi.fn();

    const result = await runCodexPrRemediation(
      {
        slug: "link-rot",
        callSite: "link-rot-remediation",
        failureTypePrefix: "LinkRotRemediation",
        prTitle: "fix(docs): repair broken links",
        prWhy: "Why",
        prWhat: "What",
        prompt: "Fix links",
        autoMerge: true,
        isAllowedPath: () => true,
        verifyAndFilter: () =>
          Promise.resolve({
            verifiedFiles: [],
            resolvedCount: 0,
            unresolvedCount: 0,
            verificationSummary: "unused",
          }),
      },
      {
        isRemediationEnabled: () => Promise.resolve(false),
        cloneRepo,
        runAgentTurn,
      },
    );

    expect(result).toEqual({
      outcome: "skipped",
      changedFiles: [],
      summary: REMEDIATION_DISABLED_SUMMARY,
    });
    expect(cloneRepo).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  test("enforces workspace-write scoped sandbox, tool-steps budget, path reverts, and verified-only PR staging", async () => {
    const repo = await createLocalGitRepo();
    let cleanedUp = false;
    let capturedTurn: RunCodexAgentTurnInput | undefined;
    let capturedOpenPrBody = "";
    let capturedFiles: readonly string[] = [];

    try {
      const result = await runCodexPrRemediation(
        {
          slug: "link-rot",
          callSite: "link-rot-remediation",
          failureTypePrefix: "LinkRotRemediation",
          prTitle: "fix(docs): repair broken links",
          prWhy: "Repair dead links found on main.",
          prWhat: "Updated broken links in documentation.",
          prompt: "Fix links",
          autoMerge: true,
          formatFiles: false,
          isAllowedPath: (path) => path === "README.md" || path === "OTHER.md",
          verifyAndFilter: async (repoDir, changedFiles) => {
            expect(changedFiles).toEqual(["OTHER.md", "README.md"]);
            expect(await Bun.file(`${repoDir}/AGENTS.md`).text()).toBe(
              "# Agents\nDo not touch\n",
            );
            expect(await Bun.file(`${repoDir}/sneaky.sh`).exists()).toBe(false);
            return {
              verifiedFiles: ["README.md"],
              resolvedCount: 1,
              unresolvedCount: 0,
              verificationSummary: "Verified 1 link via lychee.",
            };
          },
        },
        {
          isRemediationEnabled: () => Promise.resolve(true),
          env: { OPENAI_API_KEY: "dummy-openai-value" },
          createWorkspace: () =>
            Promise.resolve({
              tempDir: repo.tempDir,
              repoDir: repo.repoDir,
              cleanup: () => {
                cleanedUp = true;
                return Promise.resolve();
              },
            }),
          cloneRepo: () => Promise.resolve(),
          runAgentTurn: async (turn) => {
            capturedTurn = turn;
            await Bun.write(
              `${turn.cwd}/README.md`,
              "# Hello\nNew live link\n",
            );
            await Bun.write(`${turn.cwd}/OTHER.md`, "# Other\nBad edit\n");
            await Bun.write(`${turn.cwd}/AGENTS.md`, "# Hacked\n");
            await Bun.write(`${turn.cwd}/sneaky.sh`, "echo pwned\n");
            return fakeAgentOutcome();
          },
          mintGitHubToken: () => Promise.resolve("dummy-github"),
          findOpenPr: () => Promise.resolve(undefined),
          openPr: async (prInput) => {
            expect(await Bun.file(`${repo.repoDir}/OTHER.md`).text()).toBe(
              "# Other\nOriginal\n",
            );
            capturedOpenPrBody = prInput.body;
            capturedFiles = prInput.files;
            return {
              commitHash: "deadbeef1234",
              prUrl: "https://github.com/shepherdjerred/monorepo/pull/42",
            };
          },
          configureAutoMerge: () => Promise.resolve(true),
        },
      );

      expect(capturedTurn?.turnBudgetKind).toBe("tool-steps");
      expect(capturedTurn?.sandboxPolicy).toEqual({
        sandboxMode: "workspace-write",
        networkAccessEnabled: true,
        webSearchMode: "live",
      });
      expect(capturedTurn?.scopedPermissions).toEqual({
        denyReadPaths: expect.arrayContaining([
          "/run/secrets",
          "/var/run/secrets",
          "/proc/1",
          `/proc/${String(process.pid)}`,
        ]),
        unixSockets: [],
      });
      expect(cleanedUp).toBe(true);
      expect(capturedFiles).toEqual(["README.md"]);
      expect(capturedOpenPrBody).toContain("## Why");
      expect(capturedOpenPrBody).toContain("## What");
      expect(capturedOpenPrBody).toContain("## Verification");
      expect(capturedOpenPrBody).toContain("## Demo");
      expect(result).toMatchObject({
        outcome: "pr-created",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/42",
        commitSha: "deadbeef1234",
        autoMergeEnabled: true,
        changedFiles: ["README.md"],
        resolvedCount: 1,
        unresolvedCount: 0,
        summary: "Verified 1 link via lychee.",
      });
      expect(result.branchName).toMatch(/^chore\/link-rot-[0-9a-f]{8}$/u);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("runCodexPrRemediation reuse and no-changes cases", () => {
  test("returns pr-reused with identical content-derived branch on repeat runs", async () => {
    const repo = await createLocalGitRepo();
    try {
      const result = await runCodexPrRemediation(
        {
          slug: "vuln-fix",
          callSite: "main-vuln-remediation",
          failureTypePrefix: "MainVulnRemediation",
          prTitle: "fix(deps): remediate advisories",
          prWhy: "Why",
          prWhat: "What",
          prompt: "Upgrade deps",
          autoMerge: false,
          formatFiles: false,
          isAllowedPath: (path) => path === "README.md",
          verifyAndFilter: (_repoDir, changedFiles) =>
            Promise.resolve({
              verifiedFiles: changedFiles,
              resolvedCount: 2,
              unresolvedCount: 0,
              verificationSummary: "Lockfile verified.",
            }),
        },
        {
          ...baseLocalRepoDeps(repo),
          runAgentTurn: async (turn) => {
            await Bun.write(
              `${turn.cwd}/README.md`,
              "# Hello\nDeterministic\n",
            );
            return fakeAgentOutcome();
          },
          mintGitHubToken: () => Promise.resolve("dummy-github"),
          findOpenPr: () =>
            Promise.resolve(
              "https://github.com/shepherdjerred/monorepo/pull/77",
            ),
          openPr: () =>
            Promise.resolve({
              commitHash: "abcd1234",
              prUrl: "https://github.com/shepherdjerred/monorepo/pull/77",
            }),
          configureAutoMerge: () => Promise.resolve(false),
        },
      );

      expect(result.outcome).toBe("pr-reused");
      expect(result.autoMergeEnabled).toBe(false);
      expect(remediationBranchName("vuln-fix", "same-diff")).toBe(
        remediationBranchName("vuln-fix", "same-diff"),
      );
    } finally {
      await repo.cleanup();
    }
  });

  test("returns no-changes without minting GitHub token when verifyAndFilter yields zero files", async () => {
    const repo = await createLocalGitRepo();
    const mintGitHubToken = vi.fn();
    try {
      const result = await runCodexPrRemediation(
        {
          slug: "deps-notes",
          callSite: "deps-summary-remediation",
          failureTypePrefix: "DepsSummaryRemediation",
          prTitle: "chore(version-catalog): overrides",
          prWhy: "Why",
          prWhat: "What",
          prompt: "Find notes",
          autoMerge: false,
          formatFiles: false,
          isAllowedPath: () => true,
          verifyAndFilter: () =>
            Promise.resolve({
              verifiedFiles: [],
              resolvedCount: 0,
              unresolvedCount: 2,
              verificationSummary: "No HTTP-200 release-note URLs verified.",
            }),
        },
        {
          ...baseLocalRepoDeps(repo),
          runAgentTurn: () => Promise.resolve(fakeAgentOutcome()),
          mintGitHubToken,
        },
      );

      expect(result).toEqual({
        outcome: "no-changes",
        changedFiles: [],
        resolvedCount: 0,
        unresolvedCount: 2,
        summary: "No HTTP-200 release-note URLs verified.",
      });
      expect(mintGitHubToken).not.toHaveBeenCalled();
    } finally {
      await repo.cleanup();
    }
  });
});

describe("runCodexPrRemediation cancellation and failure cases", () => {
  test("stops before GitHub publication when canceled during verification", async () => {
    const repo = await createLocalGitRepo();
    const controller = new AbortController();
    const mintGitHubToken = vi.fn();
    const openPr = vi.fn();
    const configureAutoMerge = vi.fn();

    try {
      await expect(
        runCodexPrRemediation(
          {
            slug: "link-rot",
            callSite: "link-rot-remediation",
            failureTypePrefix: "LinkRotRemediation",
            prTitle: "fix(docs): repair broken links",
            prWhy: "Why",
            prWhat: "What",
            prompt: "Fix links",
            autoMerge: true,
            formatFiles: false,
            isAllowedPath: (path) => path === "README.md",
            verifyAndFilter: (_repoDir, changedFiles) => {
              controller.abort(new Error("activity canceled mid-verification"));
              return Promise.resolve({
                verifiedFiles: changedFiles,
                resolvedCount: 1,
                unresolvedCount: 0,
                verificationSummary: "Verified",
              });
            },
          },
          {
            ...baseLocalRepoDeps(repo),
            signal: controller.signal,
            runAgentTurn: async (turn) => {
              await Bun.write(
                `${turn.cwd}/README.md`,
                "# Hello\nNew live link\n",
              );
              return fakeAgentOutcome();
            },
            mintGitHubToken,
            openPr,
            configureAutoMerge,
          },
        ),
      ).rejects.toThrow("activity canceled mid-verification");

      expect(mintGitHubToken).not.toHaveBeenCalled();
      expect(openPr).not.toHaveBeenCalled();
      expect(configureAutoMerge).not.toHaveBeenCalled();
    } finally {
      await repo.cleanup();
    }
  });

  test("converts generationStarted AgentTurnExecutionError into non-retryable ApplicationFailure and cleans up", async () => {
    let cleanedUp = false;
    await expect(
      runCodexPrRemediation(
        {
          slug: "link-rot",
          callSite: "link-rot-remediation",
          failureTypePrefix: "LinkRotRemediation",
          prTitle: "fix",
          prWhy: "Why",
          prWhat: "What",
          prompt: "Fix",
          autoMerge: true,
          isAllowedPath: () => true,
          verifyAndFilter: () =>
            Promise.resolve({
              verifiedFiles: [],
              resolvedCount: 0,
              unresolvedCount: 0,
              verificationSummary: "unused",
            }),
        },
        {
          isRemediationEnabled: () => Promise.resolve(true),
          env: { OPENAI_API_KEY: "dummy-openai-value" },
          createWorkspace: () =>
            Promise.resolve({
              tempDir: "/tmp/fake-remediation",
              repoDir: "/tmp/fake-remediation/monorepo",
              cleanup: () => {
                cleanedUp = true;
                return Promise.resolve();
              },
            }),
          cloneRepo: () => Promise.resolve(),
          runAgentTurn: () =>
            Promise.reject(
              new AgentTurnExecutionError("quota exceeded", {
                provider: "codex",
                generationStarted: true,
                possiblyAppliedEffects: true,
                authOrQuotaFailure: true,
              }),
            ),
        },
      ),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "LinkRotRemediationPossiblyAppliedFailure",
    } satisfies Partial<ApplicationFailure>);
    expect(cleanedUp).toBe(true);
  });
});
