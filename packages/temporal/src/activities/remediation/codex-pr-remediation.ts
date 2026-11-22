import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createAgentTaskSecretTokenState } from "#activities/agent/agent-task-env.ts";
import {
  activityCancellationSignalOrUndefined,
  startToCloseTimeoutMsOrUndefined,
} from "#activities/agent/agent-task-runtime.ts";
import {
  findOpenSeasonRefreshPr,
  openSeasonRefreshPr,
  runCommand as defaultRunCommand,
  type GitCommandRunner,
  type OpenPrInput,
  type OpenPrResult,
  type SeasonRefreshPrLocator,
} from "#activities/scout/scout-season-refresh-git.ts";
import { isReportRemediationEnabled } from "#config/report-remediation.ts";
import {
  createAgentSecretRefreshHandler,
  createTemporalAgentEventHandler,
} from "#lib/agent-runner/callbacks.ts";
import { runCodexAgentTurn } from "#lib/agent-runner/codex.ts";
import type {
  AgentTurnOutcome,
  RunCodexAgentTurnInput,
} from "#lib/agent-runner/contract.ts";
import {
  AgentTurnExecutionError,
  nonRetryableGenerationFailure,
} from "#lib/agent-runner/errors.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  ReportRemediationV1Schema,
  type ReportRemediationV1,
} from "#shared/reports/report.ts";
import {
  buildRemediationPrBody,
  configureRemediationPrAutoMerge,
  enforceAllowedPaths,
  formatAndFilterAllowedFiles,
  listDirtyRepoPaths,
  remediationAgentEnv,
  remediationBranchName,
  revertUnverifiedFiles,
  unifiedDiffForFiles,
} from "./codex-pr-remediation-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_CLONE_ARGS = [
  "--branch",
  MAIN_BRANCH,
  "--single-branch",
  "--depth",
  "1",
] as const;

export const REMEDIATION_DISABLED_SUMMARY =
  "Automated report remediation is disabled by feature flag.";

export type CodexPrVerificationResult<TExtra = undefined> = {
  verifiedFiles: string[];
  resolvedCount: number;
  unresolvedCount: number;
  verificationSummary: string;
  extraNotes?: string;
  autoMerge?: boolean;
  extra?: TExtra;
};

export type RunCodexPrRemediationInput<TExtra = undefined> = {
  slug: string;
  callSite: string;
  failureTypePrefix: string;
  prTitle: string;
  prWhy: string;
  prWhat: string;
  prompt: string | ((repoDir: string) => string | Promise<string>);
  model?: string;
  maxTurns?: number;
  autoMerge: boolean;
  formatFiles?: boolean;
  cloneArgs?: readonly string[];
  isAllowedPath: (path: string) => boolean;
  prepareRepo?: (repoDir: string) => Promise<void>;
  verifyAndFilter: (
    repoDir: string,
    changedFiles: string[],
  ) => Promise<CodexPrVerificationResult<TExtra>>;
  stage?: string;
};

export type CodexPrRemediationDependencies = {
  isRemediationEnabled?: (stage?: string) => Promise<boolean>;
  createWorkspace?: (slug: string) => Promise<{
    tempDir: string;
    repoDir: string;
    cleanup: () => Promise<void>;
  }>;
  cloneRepo?: (repoDir: string, cloneArgs: readonly string[]) => Promise<void>;
  runAgentTurn?: (input: RunCodexAgentTurnInput) => Promise<AgentTurnOutcome>;
  formatFiles?: (input: {
    repoDir: string;
    changedFiles: readonly string[];
    formatFiles: boolean;
  }) => Promise<string[]>;
  mintGitHubToken?: () => Promise<string>;
  findOpenPr?: (locator: SeasonRefreshPrLocator) => Promise<string | undefined>;
  openPr?: (input: OpenPrInput) => Promise<OpenPrResult>;
  configureAutoMerge?: (input: {
    repoDir: string;
    repoSlug: string;
    prUrl: string;
    ghToken: string;
    autoMerge: boolean;
  }) => Promise<boolean>;
  commandRunner?: GitCommandRunner;
  env?: Readonly<Record<string, string | undefined>>;
};

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside a Temporal Activity context (unit tests / local harnesses).
  }
}

async function createScratchWorkspace(slug: string): Promise<{
  tempDir: string;
  repoDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(
    nodePath.join(tmpdir(), `temporal-remediation-${slug}-`),
  );
  await chmod(tempDir, 0o711);
  return {
    tempDir,
    repoDir: `${tempDir}/monorepo`,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function executeCodexTurn(input: {
  repoDir: string;
  prompt: string;
  callSite: string;
  failureTypePrefix: string;
  model: string;
  maxTurns: number;
  runAgentTurn: (turn: RunCodexAgentTurnInput) => Promise<AgentTurnOutcome>;
  sourceEnv: Readonly<Record<string, string | undefined>>;
}): Promise<AgentTurnOutcome> {
  const openAiApiKey = input.sourceEnv["OPENAI_API_KEY"];
  if (openAiApiKey === undefined || openAiApiKey === "") {
    throw new Error(
      `OPENAI_API_KEY is required for ${input.callSite} remediation`,
    );
  }
  const secretState = await createAgentTaskSecretTokenState(
    undefined,
    input.sourceEnv,
  );
  const activitySignal = activityCancellationSignalOrUndefined();
  const timeoutController = new AbortController();
  const timeoutMs = startToCloseTimeoutMsOrUndefined();
  const timeoutTimer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => {
            timeoutController.abort(
              new Error(
                `${input.callSite} stopped before Temporal start-to-close timeout`,
              ),
            );
          },
          Math.max(1, timeoutMs - 15_000),
        );
  const signal = AbortSignal.any([
    timeoutController.signal,
    ...(activitySignal === undefined ? [] : [activitySignal]),
  ]);
  let eventCount = 0;

  try {
    return await input.runAgentTurn({
      service: "temporal",
      callSite: input.callSite,
      prompt: input.prompt,
      model: input.model,
      maxTurns: input.maxTurns,
      turnBudgetKind: "turns",
      cwd: input.repoDir,
      auth: { kind: "openai-api-key", apiKey: openAiApiKey },
      env: remediationAgentEnv(openAiApiKey, input.sourceEnv),
      signal,
      sandboxPolicy: {
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        webSearchMode: "live",
      },
      redactTokens: secretState.tokens,
      beforeEvent: createAgentSecretRefreshHandler(secretState.refresh),
      onEvent: createTemporalAgentEventHandler({
        nextEventCount: () => {
          eventCount += 1;
          return eventCount;
        },
        heartbeat: safeHeartbeat,
      }),
    });
  } catch (error: unknown) {
    if (error instanceof AgentTurnExecutionError && error.generationStarted) {
      throw nonRetryableGenerationFailure(error, input.failureTypePrefix);
    }
    throw error;
  } finally {
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }
  }
}

async function publishVerifiedRemediationPr(input: {
  slug: string;
  prTitle: string;
  prWhy: string;
  prWhat: string;
  repoDir: string;
  tempDir: string;
  verifiedFiles: readonly string[];
  resolvedCount: number;
  unresolvedCount: number;
  verificationSummary: string;
  extraNotes: string | undefined;
  agentNotes: string | undefined;
  autoMerge: boolean;
  deps: CodexPrRemediationDependencies;
}): Promise<ReportRemediationV1> {
  const commandRunner = input.deps.commandRunner ?? defaultRunCommand;
  const unifiedDiff = await unifiedDiffForFiles(
    input.repoDir,
    input.verifiedFiles,
    commandRunner,
  );
  const branch = remediationBranchName(input.slug, unifiedDiff);
  const mintGitHubToken =
    input.deps.mintGitHubToken ??
    (async () => {
      const tokenResult = await createGitHubAppInstallationToken();
      return tokenResult.token;
    });
  const ghToken = await mintGitHubToken();
  const findOpenPr =
    input.deps.findOpenPr ??
    ((locator) => findOpenSeasonRefreshPr(locator, commandRunner));
  const openPr = input.deps.openPr ?? openSeasonRefreshPr;
  const configureAutoMerge =
    input.deps.configureAutoMerge ??
    ((autoMergeInput) =>
      configureRemediationPrAutoMerge({ ...autoMergeInput, commandRunner }));

  const existingPrUrl = await findOpenPr({
    repoDir: input.repoDir,
    branch,
    ghToken,
    repoSlug: REPO_SLUG,
  });
  const outcome = existingPrUrl === undefined ? "pr-created" : "pr-reused";
  const demoContent =
    input.extraNotes ??
    (input.agentNotes !== undefined && input.agentNotes.trim() !== ""
      ? input.agentNotes.trim().slice(0, 1500)
      : `\`\`\`diff\n${unifiedDiff.slice(0, 1200)}\n\`\`\``);
  const body = buildRemediationPrBody({
    why: input.prWhy,
    what: input.prWhat,
    changedFiles: input.verifiedFiles,
    resolvedCount: input.resolvedCount,
    unresolvedCount: input.unresolvedCount,
    verificationSummary: input.verificationSummary,
    demo: demoContent,
    autoMerge: input.autoMerge,
  });
  const { commitHash, prUrl } = await openPr({
    repoDir: input.repoDir,
    tempDir: input.tempDir,
    branch,
    title: input.prTitle,
    body,
    files: input.verifiedFiles,
    ghToken,
    repoSlug: REPO_SLUG,
    mainBranch: MAIN_BRANCH,
  });
  const autoMergeEnabled = await configureAutoMerge({
    repoDir: input.repoDir,
    repoSlug: REPO_SLUG,
    prUrl,
    ghToken,
    autoMerge: input.autoMerge,
  });

  return ReportRemediationV1Schema.parse({
    outcome,
    prUrl,
    branchName: branch,
    commitSha: commitHash,
    autoMergeEnabled,
    changedFiles: [...input.verifiedFiles],
    resolvedCount: input.resolvedCount,
    unresolvedCount: input.unresolvedCount,
    summary: input.verificationSummary,
  });
}

export async function runCodexPrRemediationWithExtra<TExtra = undefined>(
  input: RunCodexPrRemediationInput<TExtra>,
  deps: CodexPrRemediationDependencies = {},
): Promise<{ remediation: ReportRemediationV1; extra: TExtra | undefined }> {
  const checkEnabled = deps.isRemediationEnabled ?? isReportRemediationEnabled;
  if (!(await checkEnabled(input.stage))) {
    return {
      remediation: ReportRemediationV1Schema.parse({
        outcome: "skipped",
        changedFiles: [],
        summary: REMEDIATION_DISABLED_SUMMARY,
      }),
      extra: undefined,
    };
  }

  const startMs = Date.now();
  const heartbeat = setInterval(() => {
    safeHeartbeat({
      phase: input.callSite,
      elapsedMs: Date.now() - startMs,
    });
  }, HEARTBEAT_INTERVAL_MS);

  const createWorkspace = deps.createWorkspace ?? createScratchWorkspace;
  const workspace = await createWorkspace(input.slug);
  const commandRunner = deps.commandRunner ?? defaultRunCommand;

  try {
    const cloneRepo =
      deps.cloneRepo ??
      (async (repoDir, cloneArgs) => {
        await simpleGit().clone(REPO_URL, repoDir, [...cloneArgs]);
      });
    await cloneRepo(
      workspace.repoDir,
      input.cloneArgs ?? [...DEFAULT_CLONE_ARGS],
    );

    if (input.prepareRepo !== undefined) {
      await input.prepareRepo(workspace.repoDir);
    }

    const prompt =
      typeof input.prompt === "function"
        ? await input.prompt(workspace.repoDir)
        : input.prompt;
    const agentOutcome = await executeCodexTurn({
      repoDir: workspace.repoDir,
      prompt,
      callSite: input.callSite,
      failureTypePrefix: input.failureTypePrefix,
      model: input.model ?? DEFAULT_MODEL,
      maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
      runAgentTurn: deps.runAgentTurn ?? runCodexAgentTurn,
      sourceEnv: deps.env ?? Bun.env,
    });

    const { allowedFiles } = await enforceAllowedPaths({
      repoDir: workspace.repoDir,
      isAllowedPath: input.isAllowedPath,
      commandRunner,
    });
    const formatStep =
      deps.formatFiles ??
      ((fmtInput) =>
        formatAndFilterAllowedFiles({ ...fmtInput, commandRunner }));
    const formattedFiles = await formatStep({
      repoDir: workspace.repoDir,
      changedFiles: allowedFiles,
      formatFiles: input.formatFiles ?? true,
    });

    const verification = await input.verifyAndFilter(
      workspace.repoDir,
      formattedFiles,
    );
    const verifiedAllowed = verification.verifiedFiles.filter((path) =>
      input.isAllowedPath(path),
    );
    await revertUnverifiedFiles({
      repoDir: workspace.repoDir,
      candidateFiles: formattedFiles,
      verifiedFiles: verifiedAllowed,
      commandRunner,
    });

    const survivingDirty = new Set(
      await listDirtyRepoPaths(workspace.repoDir, commandRunner),
    );
    const finalVerifiedFiles = verifiedAllowed
      .filter((path) => survivingDirty.has(path))
      .sort((left, right) => left.localeCompare(right));

    if (finalVerifiedFiles.length === 0) {
      return {
        remediation: ReportRemediationV1Schema.parse({
          outcome: "no-changes",
          changedFiles: [],
          resolvedCount: verification.resolvedCount,
          unresolvedCount: verification.unresolvedCount,
          summary: verification.verificationSummary,
        }),
        extra: verification.extra,
      };
    }

    const remediation = await publishVerifiedRemediationPr({
      slug: input.slug,
      prTitle: input.prTitle,
      prWhy: input.prWhy,
      prWhat: input.prWhat,
      repoDir: workspace.repoDir,
      tempDir: workspace.tempDir,
      verifiedFiles: finalVerifiedFiles,
      resolvedCount: verification.resolvedCount,
      unresolvedCount: verification.unresolvedCount,
      verificationSummary: verification.verificationSummary,
      extraNotes: verification.extraNotes,
      agentNotes: agentOutcome.finalText,
      autoMerge: verification.autoMerge ?? input.autoMerge,
      deps,
    });
    return { remediation, extra: verification.extra };
  } finally {
    clearInterval(heartbeat);
    try {
      await workspace.cleanup();
    } catch (cleanupError: unknown) {
      console.warn(
        JSON.stringify({
          level: "warning",
          component: input.callSite,
          msg: "Failed to clean up remediation scratch directory",
          tempDir: workspace.tempDir,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        }),
      );
    }
  }
}

export async function runCodexPrRemediation(
  input: RunCodexPrRemediationInput,
  deps: CodexPrRemediationDependencies = {},
): Promise<ReportRemediationV1> {
  const { remediation } = await runCodexPrRemediationWithExtra(input, deps);
  return remediation;
}
