import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type Usage,
} from "@openai/codex-sdk";
import { chmod, chown, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
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
import { createAgentTurnProgress, type AgentTurnProgress } from "./progress.ts";
import {
  providerSubprocessCommand,
  providerSubprocessUid,
} from "#shared/agent/agent-subprocess-identity.ts";

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
    exclude: ["CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENROUTER_API_KEY"],
    experimental_use_profile: false,
  },
};

const CodexSubscriptionAuthSchema = z.object({
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({ access_token: z.string().min(1) }),
});

async function materializeCodexSubscriptionAuth(
  codexHome: string,
  authJson: string,
  providerUid: number | undefined,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error("Codex subscription auth is not valid JSON");
  }
  CodexSubscriptionAuthSchema.parse(parsed);
  await mkdir(codexHome, { recursive: true });
  const authPath = path.join(codexHome, "auth.json");
  await writeFile(authPath, authJson, { encoding: "utf8", mode: 0o600 });
  await chmod(authPath, 0o600);
  if (providerUid !== undefined) {
    await chown(authPath, providerUid, process.getgid?.() ?? providerUid);
  }
  return authPath;
}

type PreparedCodex = {
  options: CodexOptions;
  model: string;
  providerWrapperDirectory: string | undefined;
  subscriptionAuthPath: string | undefined;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function codexLauncherPath(): string {
  const sdkEntry = Bun.resolveSync(
    "@openai/codex-sdk",
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const sdkPackageDirectory = path.dirname(path.dirname(sdkEntry));
  return path.join(
    path.dirname(sdkPackageDirectory),
    "codex",
    "bin",
    "codex.js",
  );
}

async function materializeProviderWrapper(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "agent-codex-provider-"),
  );
  try {
    await chmod(directory, 0o755);
    const executable = path.join(directory, "codex");
    const wrappedCommand = providerSubprocessCommand(command, environment)
      .map((part) => shellQuote(part))
      .join(" ");
    await writeFile(executable, `#!/bin/sh\nexec ${wrappedCommand} "$@"\n`, {
      encoding: "utf8",
      mode: 0o755,
    });
    await chmod(executable, 0o755);
    return { directory, executable };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function providerPathOverride(input: RunCodexAgentTurnInput): Promise<{
  pathOverride: Pick<CodexOptions, "codexPathOverride"> | undefined;
  wrapperDirectory: string | undefined;
}> {
  if (providerSubprocessUid(input.env) === undefined) {
    return {
      pathOverride:
        input.codexPathOverride === undefined
          ? undefined
          : { codexPathOverride: input.codexPathOverride },
      wrapperDirectory: undefined,
    };
  }

  const command =
    input.codexPathOverride === undefined
      ? [process.execPath, codexLauncherPath()]
      : [input.codexPathOverride];
  const wrapper = await materializeProviderWrapper(command, input.env);
  return {
    pathOverride: { codexPathOverride: wrapper.executable },
    wrapperDirectory: wrapper.directory,
  };
}

async function prepareCodex(
  input: RunCodexAgentTurnInput,
): Promise<PreparedCodex> {
  const childEnvironment = Object.fromEntries(
    Object.entries(input.env).filter(
      ([key]) => key !== "OPENROUTER_API_KEY" && key !== "CODEX_ACCESS_TOKEN",
    ),
  );
  if (input.auth.kind === "openrouter") {
    const openRouter = createOpenRouterCodexConfig({
      apiKey: input.auth.apiKey,
      modelId: input.model,
      env: childEnvironment,
    });
    const providerPath = await providerPathOverride(input);
    return {
      options: {
        ...openRouter.codexOptions,
        config: CODEX_TOOL_ENVIRONMENT_CONFIG,
        ...providerPath.pathOverride,
      },
      model: openRouter.routeModelId,
      providerWrapperDirectory: providerPath.wrapperDirectory,
      subscriptionAuthPath: undefined,
    };
  }

  const codexHome = childEnvironment["CODEX_HOME"];
  if (codexHome === undefined || codexHome === "") {
    throw new Error("CODEX_HOME is required for ChatGPT subscription auth");
  }
  const subscriptionAuthPath = await materializeCodexSubscriptionAuth(
    codexHome,
    input.auth.authJson,
    providerSubprocessUid(input.env),
  );
  let providerPath: Awaited<ReturnType<typeof providerPathOverride>>;
  try {
    providerPath = await providerPathOverride(input);
  } catch (error: unknown) {
    await rm(subscriptionAuthPath, { force: true });
    throw error;
  }
  return {
    options: {
      env: childEnvironment,
      config: CODEX_TOOL_ENVIRONMENT_CONFIG,
      ...providerPath.pathOverride,
    },
    model: input.model,
    providerWrapperDirectory: providerPath.wrapperDirectory,
    subscriptionAuthPath,
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
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return false;
  }
  return ["command_execution", "file_change", "mcp_tool_call"].includes(
    event.item.type,
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
  tokens: readonly (string | undefined)[];
  parser: ReturnType<typeof createCodexJsonlParser>;
  progress: AgentTurnProgress;
  state: CodexRunState;
}): Promise<void> {
  if (!(await input.run.beforeEvent())) {
    throw new Error("secret redaction refresh failed before Codex SDK event");
  }
  const safeEvent = redactedEvent(input.event, input.tokens);
  input.parser.push(`${JSON.stringify(safeEvent)}\n`);
  input.state.stepsStarted = enforceTurnBudget({
    kind: TurnBudgetKindSchema.parse(input.run.turnBudgetKind),
    maxTurns: input.run.maxTurns,
    stepsStarted: input.state.stepsStarted,
    numTurns: input.state.numTurns,
    event: input.event,
  });
  input.state.generationStarted ||= input.event.type !== "thread.started";
  input.state.possiblyAppliedEffects ||= eventMayApplyEffect(input.event);
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
      throw new Error(input.event.error.message);
    case "error":
      throw new Error(input.event.message);
    case "item.completed":
      if (input.run.captureEvidenceEvents === true) {
        input.state.evidenceEvents.push(safeEvent);
      }
      if (input.event.item.type === "agent_message") {
        input.state.finalText = redactSecrets(
          input.event.item.text,
          input.tokens,
        );
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
  const tokens = input.redactTokens ?? [];
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
  let subscriptionAuthPath: string | undefined;

  try {
    const prepared = await prepareCodex(input);
    providerWrapperDirectory = prepared.providerWrapperDirectory;
    subscriptionAuthPath = prepared.subscriptionAuthPath;
    const codex = new Codex(prepared.options);
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
    const thread =
      input.resumeSessionId === undefined
        ? codex.startThread(threadOptions)
        : codex.resumeThread(input.resumeSessionId, threadOptions);
    const streamed = await trace.run(() =>
      thread.runStreamed(input.prompt, {
        ...(input.outputSchema === undefined
          ? {}
          : { outputSchema: input.outputSchema }),
        signal: input.signal,
      }),
    );

    for await (const event of streamed.events) {
      if (
        subscriptionAuthPath !== undefined &&
        event.type === "thread.started"
      ) {
        await rm(subscriptionAuthPath, { force: true });
        subscriptionAuthPath = undefined;
      }
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
    throw agentTurnExecutionError({
      provider: "codex",
      cause: error,
      generationStarted: state.generationStarted,
      possiblyAppliedEffects: state.possiblyAppliedEffects,
      messagePrefix: input.errorMessagePrefix ?? "Codex Agent SDK run failed",
    });
  } finally {
    if (subscriptionAuthPath !== undefined) {
      await rm(subscriptionAuthPath, { force: true });
    }
    if (providerWrapperDirectory !== undefined) {
      await rm(providerWrapperDirectory, { recursive: true, force: true });
    }
    parser.finish();
    trace.end(traceOutcome);
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
