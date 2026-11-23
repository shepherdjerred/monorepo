import { Context } from "@temporalio/activity";
import { createAgentTaskSecretTokenState } from "#activities/agent/agent-task-env.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
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
import { providerCredentialsFromEnv } from "@shepherdjerred/llm-runtime";
import {
  ReportRemediationV1Schema,
  type ReportRemediationV1,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import {
  createScratchWorkspace,
  enforceAllowedPaths,
  formatAndFilterAllowedFiles,
  isolatedRemediationCommandEnv,
  listDirtyRepoPaths,
  remediationAgentEnv,
  remediationDenyReadPaths,
  resolveRepoBaseSha,
  revertUnverifiedFiles,
} from "./codex-pr-remediation-git.ts";
import {
  createRemediationActivitySignal,
  publishVerifiedRemediationPr,
  type RemediationPublishDependencies,
} from "./codex-pr-remediation-publish.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
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

export type RemediationStepContext = {
  signal: AbortSignal;
  commandRunner: GitCommandRunner;
};

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
  prepareRepo?: (
    repoDir: string,
    context: RemediationStepContext,
  ) => Promise<void>;
  verifyAndFilter: (
    repoDir: string,
    changedFiles: string[],
    context: RemediationStepContext,
  ) => Promise<CodexPrVerificationResult<TExtra>>;
  stage?: string;
};

export type CodexPrRemediationDependencies = RemediationPublishDependencies & {
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
  commandRunner?: GitCommandRunner;
  env?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
};

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside a Temporal Activity context (unit tests / local harnesses).
  }
}

async function executeCodexTurn(input: {
  repoDir: string;
  prompt: string;
  callSite: string;
  failureTypePrefix: string;
  model: string;
  maxTurns: number;
  signal: AbortSignal;
  runAgentTurn: (turn: RunCodexAgentTurnInput) => Promise<AgentTurnOutcome>;
  sourceEnv: Readonly<Record<string, string | undefined>>;
}): Promise<AgentTurnOutcome> {
  input.signal.throwIfAborted();
  const openAiApiKey = providerCredentialsFromEnv(input.sourceEnv).openai
    ?.apiKey;
  if (openAiApiKey === undefined) {
    throw new Error(
      `OpenAI provider credentials are required for ${input.callSite} remediation`,
    );
  }
  const secretState = await createAgentTaskSecretTokenState(
    undefined,
    input.sourceEnv,
  );
  let seenEvents = 0;
  const beforeEvent = createAgentSecretRefreshHandler(secretState.refresh);
  const onEvent = createTemporalAgentEventHandler({
    nextEventCount: () => {
      seenEvents += 1;
      return seenEvents;
    },
    heartbeat: safeHeartbeat,
  });

  try {
    return await input.runAgentTurn({
      service: "temporal",
      callSite: input.callSite,
      prompt: input.prompt,
      model: input.model,
      maxTurns: input.maxTurns,
      turnBudgetKind: "tool-steps",
      cwd: input.repoDir,
      auth: { kind: "openai-api-key", apiKey: openAiApiKey },
      env: remediationAgentEnv(input.sourceEnv),
      signal: input.signal,
      sandboxPolicy: {
        sandboxMode: "workspace-write",
        networkAccessEnabled: true,
        webSearchMode: "live",
      },
      scopedPermissions: {
        denyReadPaths: remediationDenyReadPaths(),
        unixSockets: [],
      },
      redactTokens: secretState.tokens,
      beforeEvent,
      onEvent,
    });
  } catch (error: unknown) {
    if (error instanceof AgentTurnExecutionError && error.generationStarted) {
      throw nonRetryableGenerationFailure(error, input.failureTypePrefix);
    }
    throw error;
  }
}

async function verifyAndIsolateRepoChanges<TExtra>(input: {
  repoDir: string;
  baseSha: string | undefined;
  spec: RunCodexPrRemediationInput<TExtra>;
  deps: CodexPrRemediationDependencies;
  sourceEnv: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  commandRunner: GitCommandRunner;
}): Promise<{
  verification: CodexPrVerificationResult<TExtra>;
  finalVerifiedFiles: string[];
}> {
  input.signal.throwIfAborted();
  const { allowedFiles } = await enforceAllowedPaths({
    repoDir: input.repoDir,
    ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
    isAllowedPath: input.spec.isAllowedPath,
    commandRunner: input.commandRunner,
  });
  const formatStep =
    input.deps.formatFiles ??
    ((fmtInput) =>
      formatAndFilterAllowedFiles({
        ...fmtInput,
        commandRunner: input.commandRunner,
        sourceEnv: input.sourceEnv,
      }));
  const formattedFiles = await formatStep({
    repoDir: input.repoDir,
    changedFiles: allowedFiles,
    formatFiles: input.spec.formatFiles ?? true,
  });
  input.signal.throwIfAborted();
  const verification = await input.spec.verifyAndFilter(
    input.repoDir,
    formattedFiles,
    { signal: input.signal, commandRunner: input.commandRunner },
  );
  input.signal.throwIfAborted();
  const verifiedAllowed = verification.verifiedFiles.filter((path) =>
    input.spec.isAllowedPath(path),
  );
  await revertUnverifiedFiles({
    repoDir: input.repoDir,
    candidateFiles: formattedFiles,
    verifiedFiles: verifiedAllowed,
    ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
    commandRunner: input.commandRunner,
  });
  const survivingDirty = new Set(
    await listDirtyRepoPaths(input.repoDir, input.commandRunner),
  );
  return {
    verification,
    finalVerifiedFiles: verifiedAllowed
      .filter((path) => survivingDirty.has(path))
      .sort((left, right) => left.localeCompare(right)),
  };
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

  const { signal, dispose } = createRemediationActivitySignal(
    input.callSite,
    deps.signal,
  );
  const startMs = Date.now();
  const heartbeat = setInterval(() => {
    safeHeartbeat({
      phase: input.callSite,
      elapsedMs: Date.now() - startMs,
    });
  }, HEARTBEAT_INTERVAL_MS);

  const createWorkspace = deps.createWorkspace ?? createScratchWorkspace;
  const workspace = await createWorkspace(input.slug);
  const sourceEnv = deps.env ?? Bun.env;
  const baseCommandRunner = deps.commandRunner ?? defaultRunCommand;
  const commandRunner: GitCommandRunner = (command, options) => {
    signal.throwIfAborted();
    return baseCommandRunner(command, { ...options, signal });
  };

  try {
    signal.throwIfAborted();
    const cloneRepo =
      deps.cloneRepo ??
      (async (repoDir, cloneArgs) => {
        await commandRunner(
          ["git", "clone", ...cloneArgs, "--", REPO_URL, repoDir],
          {
            cwd: workspace.tempDir,
            env: isolatedRemediationCommandEnv(
              { GIT_TERMINAL_PROMPT: "0" },
              sourceEnv,
            ),
            redactOutput: true,
            operation: "repo-clone",
          },
        );
      });
    await cloneRepo(
      workspace.repoDir,
      input.cloneArgs ?? [...DEFAULT_CLONE_ARGS],
    );

    if (input.prepareRepo !== undefined) {
      signal.throwIfAborted();
      await input.prepareRepo(workspace.repoDir, { signal, commandRunner });
    }
    const baseSha = await resolveRepoBaseSha(workspace.repoDir, commandRunner);
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
      signal,
      runAgentTurn: deps.runAgentTurn ?? runCodexAgentTurn,
      sourceEnv,
    });

    const { verification, finalVerifiedFiles } =
      await verifyAndIsolateRepoChanges({
        repoDir: workspace.repoDir,
        baseSha,
        spec: input,
        deps,
        sourceEnv,
        signal,
        commandRunner,
      });

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
      signal,
      commandRunner,
      deps,
    });
    return { remediation, extra: verification.extra };
  } finally {
    dispose();
    clearInterval(heartbeat);
    await workspace.cleanup().catch((cleanupError: unknown) => {
      const error =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      console.warn(
        JSON.stringify({
          level: "warning",
          component: input.callSite,
          msg: "Failed to clean up remediation scratch directory",
          tempDir: workspace.tempDir,
          error,
        }),
      );
    });
  }
}

export async function runCodexPrRemediation(
  input: RunCodexPrRemediationInput,
  deps: CodexPrRemediationDependencies = {},
): Promise<ReportRemediationV1> {
  const { remediation } = await runCodexPrRemediationWithExtra(input, deps);
  return remediation;
}
