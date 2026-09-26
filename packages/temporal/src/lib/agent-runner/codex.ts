import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type Usage,
} from "@openai/codex-sdk";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";
import { register } from "#observability/metrics.ts";
import { redactSecrets } from "#shared/redact.ts";
import type {
  AgentTurnOutcome,
  AgentTurnUsage,
  RunCodexAgentTurnInput,
  TurnBudgetKind,
} from "./contract.ts";
import { SandboxPolicySchema, TurnBudgetKindSchema } from "./contract.ts";
import { agentTurnExecutionError } from "./errors.ts";
import { cleanupCodexRun } from "./codex-cleanup.ts";
import {
  prepareCodexApiKeyHome,
  prepareCodexSubscriptionHome,
  rollbackCodexApiKeyHome,
  restoreCodexSubscriptionParentMode,
} from "./codex-home.ts";
import type { ProviderHomeParentMode } from "./provider-home.ts";
import { runSubscriptionCodexEvents } from "./codex-app-server/turn.ts";
import { codexSubscriptionTokens } from "./codex-app-server/protocol.ts";
import { createAgentTurnProgress, type AgentTurnProgress } from "./progress.ts";
import {
  prepareProviderWorkspace,
  restoreProviderWorkspace,
} from "./provider-workspace.ts";
import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";
import {
  isProviderCredentialKey,
  PROVIDER_CREDENTIAL_ENV_VARS,
} from "#shared/agent/provider-credentials.ts";
import { codexLauncherPath, providerPathOverride } from "./codex-launcher.ts";

const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
]);

const CODEX_TOOL_ENVIRONMENT_CONFIG = {
  allow_login_shell: false,
  shell_environment_policy: {
    inherit: "all",
    ignore_default_excludes: false,
    exclude: [...PROVIDER_CREDENTIAL_ENV_VARS],
    experimental_use_profile: false,
  },
};

type PreparedCodex = {
  options: CodexOptions;
  model: string;
  providerWrapperDirectory: string | undefined;
  providerHomeDirectory: string | undefined;
  subscriptionHome: string | undefined;
  subscriptionParentMode: ProviderHomeParentMode | undefined;
};

async function rollbackCodexSubscriptionPreparation(input: {
  codexHome: string;
  parentMode: ProviderHomeParentMode | undefined;
}): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of [
    () => restoreProviderWorkspace(input.codexHome),
    () => restoreCodexSubscriptionParentMode(input.parentMode),
  ]) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Codex subscription preparation rollback failed",
    );
  }
}

async function prepareCodex(
  input: RunCodexAgentTurnInput,
): Promise<PreparedCodex> {
  const providerUid = providerSubprocessUid();
  await prepareProviderWorkspace(input.cwd, providerUid);
  const childEnvironment = Object.fromEntries(
    Object.entries(input.env).filter(([key]) => !isProviderCredentialKey(key)),
  );
  if (input.auth.kind === "openai-api-key") {
    const providerHome = await prepareCodexApiKeyHome({
      environment: childEnvironment,
      providerUid,
      resumeSessionId: input.resumeSessionId,
    });
    try {
      const codexConfig = createCodexConfig({
        apiKey: input.auth.apiKey,
        modelId: input.model,
        env: {
          ...childEnvironment,
          ...providerHome.environment,
        },
      });
      const providerPath = await providerPathOverride(input);
      return {
        options: {
          ...codexConfig.codexOptions,
          config: CODEX_TOOL_ENVIRONMENT_CONFIG,
          ...providerPath.pathOverride,
        },
        model: codexConfig.routeModelId,
        providerWrapperDirectory: providerPath.wrapperDirectory,
        providerHomeDirectory: providerHome.providerHomeDirectory,
        subscriptionHome: providerHome.subscriptionHome,
        subscriptionParentMode: providerHome.subscriptionParentMode,
      };
    } catch (error: unknown) {
      try {
        await rollbackCodexApiKeyHome(providerHome);
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error],
          "Codex API-key setup cleanup failed",
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }

  const codexHome = childEnvironment["CODEX_HOME"];
  if (codexHome === undefined || codexHome === "") {
    throw new Error("CODEX_HOME is required for ChatGPT subscription auth");
  }
  codexSubscriptionTokens(input.auth.authJson);
  const subscriptionParentMode = await prepareCodexSubscriptionHome(
    codexHome,
    providerUid,
  );
  let providerPath: Awaited<ReturnType<typeof providerPathOverride>>;
  try {
    providerPath = await providerPathOverride(input);
  } catch (error: unknown) {
    try {
      await rollbackCodexSubscriptionPreparation({
        codexHome,
        parentMode: subscriptionParentMode,
      });
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error],
        "Codex provider setup and subscription preparation rollback failed",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  return {
    options: {
      env: { ...childEnvironment, HOME: codexHome },
      config: CODEX_TOOL_ENVIRONMENT_CONFIG,
      ...providerPath.pathOverride,
    },
    model: input.model,
    providerWrapperDirectory: providerPath.wrapperDirectory,
    providerHomeDirectory: undefined,
    subscriptionHome: codexHome,
    subscriptionParentMode,
  };
}

function emptyUsage(): AgentTurnUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function normalizedUsage(usage: Usage | undefined): AgentTurnUsage {
  if (usage === undefined) return emptyUsage();
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
  };
}

function addUsage(left: Usage | undefined, right: Usage): Usage {
  if (left === undefined) return right;
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
    cache_write_input_tokens:
      left.cache_write_input_tokens + right.cache_write_input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    reasoning_output_tokens:
      left.reasoning_output_tokens + right.reasoning_output_tokens,
  };
}

function eventMayApplyEffect(event: ThreadEvent): boolean {
  return (
    (event.type === "item.started" || event.type === "item.completed") &&
    ["command_execution", "file_change", "mcp_tool_call"].includes(
      event.item.type,
    )
  );
}

function redactedEvent(
  event: ThreadEvent,
  tokens: readonly (string | undefined)[],
): unknown {
  return JSON.parse(redactSecrets(JSON.stringify(event), tokens));
}

export function codexAgentStepViolation(input: {
  maxTurns: number;
  stepsStarted: number;
  event: ThreadEvent;
}): { stepsStarted: number; violation: string | undefined } {
  if (
    input.event.type !== "item.started" ||
    !CODEX_TOOL_ITEM_TYPES.has(input.event.item.type)
  ) {
    return { stepsStarted: input.stepsStarted, violation: undefined };
  }

  const stepsStarted = input.stepsStarted + 1;
  return {
    stepsStarted,
    violation:
      stepsStarted > input.maxTurns
        ? `Codex SDK exceeded maxTurns (${String(input.maxTurns)}) after ${String(stepsStarted)} tool steps`
        : undefined,
  };
}

function enforceTurnBudget(input: {
  kind: TurnBudgetKind;
  maxTurns: number;
  stepsStarted: number;
  numTurns: number;
  event: ThreadEvent;
}): number {
  if (input.kind === "turns") {
    if (
      input.event.type === "turn.started" &&
      input.numTurns >= input.maxTurns
    ) {
      throw new Error(
        `Codex agent exceeded maxTurns=${String(input.maxTurns)}`,
      );
    }
    return input.stepsStarted;
  }

  const result = codexAgentStepViolation(input);
  if (result.violation !== undefined) throw new Error(result.violation);
  return result.stepsStarted;
}

type CodexRunState = {
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
  finalText: string | undefined;
  sessionId: string | undefined;
  usage: Usage | undefined;
  numTurns: number;
  stepsStarted: number;
  evidenceEvents: unknown[];
};

async function handleEvent(input: {
  run: RunCodexAgentTurnInput;
  event: ThreadEvent;
  tokens: () => readonly (string | undefined)[];
  parser: ReturnType<typeof createCodexJsonlParser>;
  progress: AgentTurnProgress;
  state: CodexRunState;
}): Promise<void> {
  input.state.generationStarted ||= input.event.type !== "thread.started";
  input.state.possiblyAppliedEffects ||= eventMayApplyEffect(input.event);
  if (!(await input.run.beforeEvent())) {
    throw new Error("secret redaction refresh failed before Codex SDK event");
  }
  const tokens = input.tokens();
  const safeEvent = redactedEvent(input.event, tokens);
  input.parser.push(`${JSON.stringify(safeEvent)}\n`);
  input.state.stepsStarted = enforceTurnBudget({
    kind: TurnBudgetKindSchema.parse(input.run.turnBudgetKind),
    maxTurns: input.run.maxTurns,
    stepsStarted: input.state.stepsStarted,
    numTurns: input.state.numTurns,
    event: input.event,
  });
  input.progress.observe(input.event.type);
  const violation = input.run.eventViolation?.(input.event);
  if (violation !== undefined) throw new Error(violation);

  switch (input.event.type) {
    case "thread.started":
      input.state.sessionId = input.event.thread_id;
      break;
    case "turn.completed":
      input.state.usage = addUsage(input.state.usage, input.event.usage);
      input.state.numTurns += 1;
      break;
    case "turn.failed":
      throw new Error(redactSecrets(input.event.error.message, tokens));
    case "error":
      throw new Error(redactSecrets(input.event.message, tokens));
    case "item.completed":
      if (input.run.captureEvidenceEvents === true) {
        input.state.evidenceEvents.push(safeEvent);
      }
      if (input.event.item.type === "agent_message") {
        input.state.finalText = redactSecrets(input.event.item.text, tokens);
      }
      break;
    case "turn.started":
    case "item.started":
    case "item.updated":
      break;
  }
}

export async function runCodexAgentTurn(
  input: RunCodexAgentTurnInput,
): Promise<AgentTurnOutcome> {
  const sandboxPolicy = SandboxPolicySchema.parse(input.sandboxPolicy);
  const startedAtMs = Date.now();
  const progress = createAgentTurnProgress(startedAtMs, input.onEvent);
  const providerTokens: (string | undefined)[] = [
    ...(input.auth.kind === "chatgpt-subscription"
      ? [input.auth.authJson]
      : [input.auth.apiKey]),
  ];
  const tokens = (): readonly (string | undefined)[] => [
    ...(input.redactTokens ?? []),
    ...providerTokens,
  ];
  const parser =
    input.warn === undefined
      ? createCodexJsonlParser()
      : createCodexJsonlParser({ warn: input.warn });
  const trace = attachCodexTrace(parser, {
    service: input.service,
    callSite: input.callSite,
    model: input.model,
    system: "codex_sdk",
    initialPrompt: input.prompt,
    ...(input.warn === undefined ? {} : { logger: { warn: input.warn } }),
    metricsRegister: register,
    workload: input.callSite,
  });
  let traceOutcome: "success" | "error" | "cancelled" = "success";
  const state: CodexRunState = {
    generationStarted: false,
    possiblyAppliedEffects: false,
    finalText: undefined,
    sessionId: undefined,
    usage: undefined,
    numTurns: 0,
    stepsStarted: 0,
    evidenceEvents: [],
  };
  let providerWrapperDirectory: string | undefined;
  let providerHomeDirectory: string | undefined;
  let subscriptionHome: string | undefined;
  let subscriptionParentMode: ProviderHomeParentMode | undefined;
  let runFailure: { cause: unknown } | undefined;

  try {
    const prepared = await prepareCodex(input);
    providerWrapperDirectory = prepared.providerWrapperDirectory;
    providerHomeDirectory = prepared.providerHomeDirectory;
    subscriptionHome = prepared.subscriptionHome;
    subscriptionParentMode = prepared.subscriptionParentMode;
    if (input.auth.kind === "chatgpt-subscription") {
      const auth = codexSubscriptionTokens(input.auth.authJson);
      providerTokens.push(auth.access_token, auth.refresh_token, auth.id_token);
    }
    const threadOptions = {
      approvalPolicy: "never",
      model: prepared.model,
      modelReasoningEffort: "high",
      networkAccessEnabled: sandboxPolicy.networkAccessEnabled,
      sandboxMode: sandboxPolicy.sandboxMode,
      webSearchMode: sandboxPolicy.webSearchMode,
      workingDirectory: input.cwd,
      skipGitRepoCheck: input.skipGitRepoCheck ?? false,
    } as const;
    const streamed = await trace.run(async () => {
      if (input.auth.kind === "chatgpt-subscription") {
        if (prepared.options.env === undefined)
          throw new Error("Missing subscription child environment");
        const command =
          prepared.options.codexPathOverride === undefined
            ? [process.execPath, codexLauncherPath()]
            : [prepared.options.codexPathOverride];
        return {
          events: runSubscriptionCodexEvents({
            excludedKeys:
              CODEX_TOOL_ENVIRONMENT_CONFIG.shell_environment_policy.exclude,
            run: input,
            command,
            environment: prepared.options.env,
            authJson: input.auth.authJson,
            onExecutionState: (possiblyAppliedEffects) => {
              state.generationStarted = true;
              state.possiblyAppliedEffects ||= possiblyAppliedEffects;
            },
          }),
        };
      }
      const codex = new Codex(prepared.options);
      const thread =
        input.resumeSessionId === undefined
          ? codex.startThread(threadOptions)
          : codex.resumeThread(input.resumeSessionId, threadOptions);
      return thread.runStreamed(input.prompt, {
        ...(input.outputSchema === undefined
          ? {}
          : { outputSchema: input.outputSchema }),
        signal: input.signal,
      });
    });

    for await (const event of streamed.events) {
      await handleEvent({
        run: input,
        event,
        tokens,
        parser,
        progress,
        state,
      });
    }
    if (input.requireFinalText === true && state.finalText === undefined) {
      throw new Error("Codex SDK completed without a structured agent message");
    }
  } catch (error: unknown) {
    traceOutcome = input.signal.aborted ? "cancelled" : "error";
    runFailure = { cause: error };
  }

  const cleanupFailure = await cleanupCodexRun({
    workdir: input.cwd,
    subscriptionAuthPath: undefined,
    subscriptionHome,
    subscriptionParentMode,
    providerWrapperDirectory,
    providerHomeDirectory,
    parser,
    trace,
    traceOutcome,
  });

  const failure = runFailure ?? cleanupFailure;
  if (failure !== undefined) {
    throw agentTurnExecutionError({
      provider: "codex",
      cause: failure.cause,
      generationStarted: state.generationStarted,
      possiblyAppliedEffects: state.possiblyAppliedEffects,
      messagePrefix: input.errorMessagePrefix ?? "Codex Agent SDK run failed",
    });
  }

  return {
    finalText: state.finalText,
    evidenceEvents: state.evidenceEvents,
    sessionId: state.sessionId,
    usage: normalizedUsage(state.usage),
    numTurns: state.numTurns,
    generationStarted: state.generationStarted,
    possiblyAppliedEffects: state.possiblyAppliedEffects,
    ...progress.summary(),
  };
}
