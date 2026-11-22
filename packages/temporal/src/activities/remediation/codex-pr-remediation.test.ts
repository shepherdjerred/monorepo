import type { ApplicationFailure } from "@temporalio/common";
import { describe, expect, test, vi } from "vitest";
import type { AgentTurnOutcome } from "#lib/agent-runner/contract.ts";
import { AgentTurnExecutionError } from "#lib/agent-runner/errors.ts";
import {
  REMEDIATION_DISABLED_SUMMARY,
  runCodexPrRemediation,
  type CodexPrRemediationDependencies,
} from "./codex-pr-remediation.ts";
import {
  configureRemediationPrAutoMerge,
  enforceAllowedPaths,
  remediationAgentEnv,
  remediationBranchName,
} from "./codex-pr-remediation-git.ts";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
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

describe("remediationAgentEnv", () => {
  test("exposes OPENAI_API_KEY while stripping GitHub, Postal, S3, and Temporal secrets", () => {
    const env = remediationAgentEnv("dummy-openai-value", {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      GH_TOKEN: "dummy-gh",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "dummy-pem",
      POSTAL_API_KEY: "dummy-postal",
      AWS_ACCESS_KEY_ID: "dummy-aws-id",
      AWS_SECRET_ACCESS_KEY: "dummy-aws",
      S3_ENDPOINT: "https://s3.internal",
      REPORT_HUB_INGEST_TOKEN: "dummy-hub",
      TEMPORAL_API_KEY: "dummy-temporal",
      ANTHROPIC_API_KEY: "dummy-anthropic",
      WOODPECKER_TOKEN: "dummy-woodpecker",
      FLAGS_MACHINE_TOKEN: "dummy-flags",
      DOCKERHUB_READ_CONFIG_JSON: '{"auths":{}}',
    });

    expect(env["OPENAI_API_KEY"]).toBe("dummy-openai-value");
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["HOME"]).toBe("/tmp/home");
    expect(env["GH_TOKEN"]).toBeUndefined();
    expect(env["GITHUB_APP_ID"]).toBeUndefined();
    expect(env["GITHUB_APP_PRIVATE_KEY"]).toBeUndefined();
    expect(env["POSTAL_API_KEY"]).toBeUndefined();
    expect(env["AWS_ACCESS_KEY_ID"]).toBeUndefined();
    expect(env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    expect(env["S3_ENDPOINT"]).toBeUndefined();
    expect(env["REPORT_HUB_INGEST_TOKEN"]).toBeUndefined();
    expect(env["TEMPORAL_API_KEY"]).toBeUndefined();
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["WOODPECKER_TOKEN"]).toBeUndefined();
    expect(env["FLAGS_MACHINE_TOKEN"]).toBeUndefined();
    expect(env["DOCKERHUB_READ_CONFIG_JSON"]).toBeUndefined();
  });
});

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

  test("reverts disallowed tracked/untracked files and unverified files, opening a PR only for verified files", async () => {
    const repo = await createLocalGitRepo();
    let cleanedUp = false;
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
            // Disallowed edits must ALREADY be reverted before verifyAndFilter runs!
            expect(changedFiles).toEqual(["OTHER.md", "README.md"]);
            expect(await Bun.file(`${repoDir}/AGENTS.md`).text()).toBe(
              "# Agents\nDo not touch\n",
            );
            expect(await Bun.file(`${repoDir}/sneaky.sh`).exists()).toBe(false);
            // Reject OTHER.md, verify only README.md
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
            // Unverified OTHER.md must be reverted before PR staging!
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

describe("runCodexPrRemediation reuse and failure cases", () => {
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

describe("configureRemediationPrAutoMerge", () => {
  test("catches gh pr merge --auto failure cleanly and returns false", async () => {
    const enabled = await configureRemediationPrAutoMerge({
      repoDir: "/tmp",
      repoSlug: "shepherdjerred/monorepo",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/9",
      ghToken: "dummy-github",
      autoMerge: true,
      commandRunner: () => Promise.reject(new Error("auto-merge not allowed")),
    });
    expect(enabled).toBe(false);
  });

  test("disables previously armed auto-merge and confirms disabled state when autoMerge is false", async () => {
    const calls: string[][] = [];
    let viewCalls = 0;
    const enabled = await configureRemediationPrAutoMerge({
      repoDir: "/tmp",
      repoSlug: "shepherdjerred/monorepo",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/10",
      ghToken: "dummy-github",
      autoMerge: false,
      commandRunner: (command) => {
        calls.push(command);
        if (command[1] === "pr" && command[2] === "view") {
          viewCalls += 1;
          return Promise.resolve(viewCalls === 1 ? "true" : "false");
        }
        return Promise.resolve("");
      },
    });
    expect(enabled).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("--disable-auto");
  });

  test("throws when disabling auto-merge fails or leaves auto-merge armed on a review-only PR", async () => {
    await expect(
      configureRemediationPrAutoMerge({
        repoDir: "/tmp",
        repoSlug: "shepherdjerred/monorepo",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/11",
        ghToken: "dummy-github",
        autoMerge: false,
        commandRunner: (command) =>
          command[1] === "pr" && command[2] === "view"
            ? Promise.resolve("true")
            : Promise.resolve(""),
      }),
    ).rejects.toThrow("Auto-merge remained enabled");
  });
});

describe("enforceAllowedPaths baseSha guard", () => {
  test("resets committed out-of-scope agent edits back to baseSha", async () => {
    const repo = await createLocalGitRepo();
    try {
      const baseSha = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repo.repoDir,
      });
      await Bun.write(`${repo.repoDir}/AGENTS.md`, "# Pwned\n");
      await runCommand(["git", "add", "AGENTS.md"], { cwd: repo.repoDir });
      await runCommand(["git", "commit", "-m", "sneaky commit"], {
        cwd: repo.repoDir,
      });
      await Bun.write(`${repo.repoDir}/README.md`, "# Hello\nAllowed fix\n");

      const enforced = await enforceAllowedPaths({
        repoDir: repo.repoDir,
        baseSha,
        isAllowedPath: (path) => path === "README.md",
      });

      expect(enforced.allowedFiles).toEqual(["README.md"]);
      expect(enforced.revertedFiles).toContain("AGENTS.md");
      expect(
        await runCommand(["git", "rev-parse", "HEAD"], { cwd: repo.repoDir }),
      ).toBe(baseSha);
      expect(await Bun.file(`${repo.repoDir}/AGENTS.md`).text()).toBe(
        "# Agents\nDo not touch\n",
      );
    } finally {
      await repo.cleanup();
    }
  });
});
