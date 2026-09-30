import {
  query,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import path from "node:path";
import { traceClaudeAgent } from "@shepherdjerred/llm-observability/wrappers/claude-agent";
import { register } from "#observability/metrics.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  ClaudePermissionPolicySchema,
  type AgentTurnOutcome,
  type AgentTurnUsage,
  type RunClaudeAgentTurnInput,
} from "./contract.ts";
import { agentTurnExecutionError } from "./errors.ts";
import {
  prepareIsolatedProviderHome,
  restoreProviderHomeParentMode,
} from "./provider-home.ts";
import { createAgentTurnProgress, type AgentTurnProgress } from "./progress.ts";
import {
  prepareProviderWorkspace,
  restoreProviderWorkspace,
} from "./provider-workspace.ts";
import {
  providerSubprocessCommand,
  providerSubprocessUid,
} from "#shared/agent/agent-subprocess-identity.ts";
import {
  isProviderCredentialKey,
  PROVIDER_CREDENTIAL_ENV_VARS,
} from "#shared/agent/provider-credentials.ts";

function emptyUsage(): AgentTurnUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function normalizedUsage(result: SDKResultMessage): AgentTurnUsage {
  return {
    inputTokens: result.usage.input_tokens,
    cachedInputTokens: result.usage.cache_read_input_tokens,
    cacheWriteInputTokens: result.usage.cache_creation_input_tokens,
    outputTokens: result.usage.output_tokens,
    reasoningTokens: 0,
  };
}

function messageType(message: SDKMessage): string {
  return "subtype" in message && typeof message.subtype === "string"
    ? `${message.type}.${message.subtype}`
    : message.type;
}

function messageMayApplyEffect(message: SDKMessage): boolean {
  return (
    message.type === "assistant" &&
    message.message.content.some(
      (block) => block.type === "tool_use" || block.type === "server_tool_use",
    )
  );
}

function redactedMessage(
  message: SDKMessage,
  tokens: readonly (string | undefined)[],
): SDKMessage {
  const clone = structuredClone(message);
  redactMessageValues(clone, tokens);
  return clone;
}

function redactedError(
  error: unknown,
  tokens: readonly (string | undefined)[],
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const safeError = new Error(redactSecrets(message, tokens));
  safeError.name = "Error";
  return safeError;
}

async function* redactClaudeFailures(
  messages: AsyncIterable<SDKMessage>,
  tokens: () => readonly (string | undefined)[],
): AsyncIterable<SDKMessage> {
  try {
    yield* messages;
  } catch (error: unknown) {
    // The tracing wrapper observes iterator failures before this runner's outer
    // catch. Replace the exception here so provider credentials cannot reach
    // either span exception fields or the eventual Temporal failure history.
    throw redactedError(error, tokens());
  }
}

function redactMessageValues(
  value: unknown,
  tokens: readonly (string | undefined)[],
): void {
  if (value === null || typeof value !== "object") return;
  for (const key of Reflect.ownKeys(value)) {
    const member: unknown = Reflect.get(value, key);
    if (typeof member === "string") {
      Reflect.set(value, key, redactSecrets(member, tokens));
    } else {
      redactMessageValues(member, tokens);
    }
  }
}

function isToolResultMessage(message: SDKMessage): boolean {
  return (
    message.type === "user" &&
    (message.tool_use_result !== undefined ||
      (Array.isArray(message.message.content) &&
        message.message.content.some((block) => block.type === "tool_result")))
  );
}

function queryOptions(
  input: RunClaudeAgentTurnInput,
  providerUid: number | undefined,
): Options {
  const permissionMode = ClaudePermissionPolicySchema.parse(
    input.permissionPolicy,
  );
  const childEnvironment = Object.fromEntries(
    Object.entries(input.env).filter(([key]) => !isProviderCredentialKey(key)),
  );
  return {
    abortController: new AbortController(),
    cwd: input.cwd,
    env: {
      ...childEnvironment,
      CLAUDE_CODE_OAUTH_TOKEN: input.auth.oauthToken,
    },
    maxTurns: input.maxTurns,
    model: input.model,
    permissionMode,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    },
    settings: {
      sandbox: {
        credentials: {
          envVars: PROVIDER_CREDENTIAL_ENV_VARS.map((name) => ({
            name,
            mode: "deny" as const,
          })),
        },
      },
    },
    settingSources: [],
    spawnClaudeCodeProcess: (options) => {
      const [command, ...args] = providerSubprocessCommand(
        [options.command, ...options.args],
        providerUid === undefined
          ? {}
          : { AGENT_PROVIDER_UID: providerUid.toString() },
      );
      if (command === undefined) {
        throw new Error("Claude provider command is empty");
      }
      return spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        stdio: ["pipe", "pipe", "pipe"],
      });
    },
    ...(permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(input.resumeSessionId === undefined
      ? {}
      : { resume: input.resumeSessionId }),
    ...(input.outputSchema === undefined
      ? {}
      : {
          outputFormat: {
            type: "json_schema",
            schema: input.outputSchema,
          },
        }),
  };
}

type ClaudeRunState = {
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
  finalText: string | undefined;
  sessionId: string | undefined;
  usage: AgentTurnUsage;
  numTurns: number;
  evidenceEvents: unknown[];
};

function markMessageExecutionState(
  state: ClaudeRunState,
  message: SDKMessage,
): void {
  state.generationStarted ||=
    message.type === "assistant" || message.type === "result";
  state.possiblyAppliedEffects ||= messageMayApplyEffect(message);
}

function successfulResultText(
  result: SDKResultMessage,
  outputSchema: Record<string, unknown> | undefined,
): string {
  if (result.subtype === "success") {
    if (outputSchema === undefined) return result.result;
    if (result.structured_output === undefined) {
      throw new Error(
        "Claude returned no structured output for a schema-constrained turn",
      );
    }
    const serialized = JSON.stringify(result.structured_output);
    return serialized;
  }
  const detail = result.errors.join("; ");
  throw new Error(
    detail === "" ? `Claude turn ended with ${result.subtype}` : detail,
  );
}

function handleMessage(input: {
  run: RunClaudeAgentTurnInput;
  message: SDKMessage;
  tokens: readonly (string | undefined)[];
  progress: AgentTurnProgress;
  state: ClaudeRunState;
}): void {
  markMessageExecutionState(input.state, input.message);
  input.progress.observe(messageType(input.message));

  if (input.message.type === "system" && input.message.subtype === "init") {
    input.state.sessionId = input.message.session_id;
    return;
  }
  if (input.message.type === "assistant") {
    if (input.run.captureEvidenceEvents === true) {
      input.state.evidenceEvents.push(
        redactedMessage(input.message, input.tokens),
      );
    }
    return;
  }
  if (isToolResultMessage(input.message)) {
    if (input.run.captureEvidenceEvents === true) {
      input.state.evidenceEvents.push(
        redactedMessage(input.message, input.tokens),
      );
    }
    return;
  }
  if (input.message.type !== "result") return;

  if (input.run.captureEvidenceEvents === true) {
    input.state.evidenceEvents.push(
      redactedMessage(input.message, input.tokens),
    );
  }
  input.state.sessionId = input.message.session_id;
  input.state.usage = normalizedUsage(input.message);
  input.state.numTurns = input.message.num_turns;
  input.state.finalText = redactSecrets(
    successfulResultText(input.message, input.run.outputSchema),
    input.tokens,
  );
}

export async function runClaudeAgentTurn(
  input: RunClaudeAgentTurnInput,
): Promise<AgentTurnOutcome> {
  const startedAtMs = Date.now();
  const progress = createAgentTurnProgress(startedAtMs, input.onEvent);
  const tokens = (): readonly (string | undefined)[] => [
    ...(input.redactTokens ?? []),
    input.auth.oauthToken,
  ];
  const providerUid = providerSubprocessUid();
  const options = queryOptions(input, providerUid);
  const abortController = options.abortController;
  if (abortController === undefined) {
    throw new Error("Claude query options are missing an abort controller");
  }
  const abort = (): void => {
    abortController.abort();
  };
  if (input.signal.aborted) abort();
  input.signal.addEventListener("abort", abort, { once: true });

  const state: ClaudeRunState = {
    generationStarted: false,
    possiblyAppliedEffects: false,
    finalText: undefined,
    sessionId: undefined,
    usage: emptyUsage(),
    numTurns: 0,
    evidenceEvents: [],
  };
  let failure: { cause: unknown } | undefined;
  let providerHome: Awaited<ReturnType<typeof prepareIsolatedProviderHome>>;

  try {
    if (
      input.resumeSessionId !== undefined &&
      (input.resumeWorkspacePath === undefined ||
        !path.isAbsolute(input.cwd) ||
        path.resolve(input.cwd) !== input.resumeWorkspacePath)
    ) {
      throw new Error(
        "Claude resume requires the original checkpoint workspace path",
      );
    }
    providerHome = await prepareIsolatedProviderHome(
      input.env["HOME"],
      providerUid,
    );
    await prepareProviderWorkspace(input.cwd, providerUid);
    input.signal.throwIfAborted();
    const messages = traceClaudeAgent<SDKMessage>(
      {
        service: input.service,
        callSite: input.callSite,
        request: {
          model: input.model,
          prompt: redactSecrets(input.prompt, tokens()),
          options: {
            maxTurns: input.maxTurns,
            permissionMode: input.permissionPolicy,
            resumed: input.resumeSessionId !== undefined,
          },
        },
        metricsRegister: register,
        workload: input.callSite,
      },
      () =>
        redactClaudeFailures(query({ prompt: input.prompt, options }), tokens),
      async (message) => {
        markMessageExecutionState(state, message);
        if (!(await input.beforeEvent())) {
          throw new Error(
            "secret redaction refresh failed before Claude Agent SDK event",
          );
        }
        return redactedMessage(message, tokens());
      },
    );

    // Iterating the SDK stream submits the provider request. Any failure from
    // this point may follow acceptance even when no output message arrives.
    state.generationStarted = true;
    for await (const message of messages) {
      handleMessage({ run: input, message, tokens: tokens(), progress, state });
    }
    if (state.finalText === undefined && input.requireFinalText === true) {
      throw new Error(
        "Claude Agent SDK completed without a structured agent message",
      );
    }
  } catch (error: unknown) {
    failure = { cause: redactedError(error, tokens()) };
  } finally {
    input.signal.removeEventListener("abort", abort);
  }
  for (const directory of [
    input.cwd,
    ...(providerHome === undefined ? [] : [providerHome.directory]),
  ]) {
    try {
      await restoreProviderWorkspace(directory);
    } catch (error: unknown) {
      failure ??= { cause: redactedError(error, tokens()) };
    }
  }
  try {
    await restoreProviderHomeParentMode(providerHome?.parentMode);
  } catch (error: unknown) {
    failure ??= { cause: redactedError(error, tokens()) };
  }
  if (failure !== undefined) {
    throw agentTurnExecutionError({
      provider: "claude",
      cause: failure.cause,
      generationStarted: state.generationStarted,
      possiblyAppliedEffects: state.possiblyAppliedEffects,
      messagePrefix: input.errorMessagePrefix ?? "Claude Agent SDK run failed",
    });
  }

  return {
    finalText: state.finalText,
    evidenceEvents: state.evidenceEvents,
    sessionId: state.sessionId,
    usage: state.usage,
    numTurns: state.numTurns,
    generationStarted: state.generationStarted,
    possiblyAppliedEffects: state.possiblyAppliedEffects,
    ...progress.summary(),
  };
}
