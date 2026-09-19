import { Context } from "@temporalio/activity";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { runAgentTurn } from "#lib/agent-runner/run.ts";
import {
  AgentChatTurnResultSchema,
  RunAgentChatTurnInputSchema,
  type AgentChatTurnResult,
  type RunAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import {
  createAgentTaskSecretTokenState,
  agentTaskProviderSecretTokens,
  envForEvidenceCollector,
} from "#activities/agent/agent-task-env.ts";
import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";
import {
  pullLatestAgentChatSessionBundle,
  pushAgentChatSessionBundle,
} from "./session-bundle.ts";
import {
  createAgentChatS3Store,
  type AgentChatObjectStore,
} from "./session-store.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;
const AgentChatRuntimeConfigSchema = z.strictObject({
  bundlePrefix: z.string().min(1),
  bucket: z.string().min(1),
  region: z.string().min(1),
  runtimeRoot: z.string().min(1),
});
const AGENT_CHAT_RUNTIME_CONFIG = AgentChatRuntimeConfigSchema.parse({
  bundlePrefix: "agent-chats",
  bucket: "agent-chat-sessions",
  region: "us-east-1",
  runtimeRoot: "/tmp/agent-chats",
});

function requiredEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for durable agent chats`);
  }
  return value;
}

function sessionPaths(
  baseDirectory: string,
  chatId: string,
): {
  root: string;
  sessionHome: string;
  workspacePath: string;
} {
  const root = path.join(baseDirectory, chatId);
  return {
    root,
    sessionHome: path.join(root, "session"),
    workspacePath: path.join(root, "workspace"),
  };
}

function providerEnvironment(input: {
  provider: "claude" | "codex";
  sessionHome: string;
  sourceEnv: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const environment = envForEvidenceCollector(
    path.join(input.sessionHome, "home"),
    input.sourceEnv,
  );
  environment["HOME"] = path.join(input.sessionHome, "home");
  if (input.provider === "codex") {
    environment["CODEX_HOME"] = path.join(input.sessionHome, "codex-home");
  }
  return environment;
}

async function prepareProviderRuntime(input: {
  provider: "claude" | "codex";
  sessionHome: string;
  workspacePath: string;
  sourceEnv: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const uid = providerSubprocessUid(input.sourceEnv);
  if (uid === undefined) return;

  await mkdir(
    path.join(
      input.sessionHome,
      input.provider === "codex" ? "codex-home" : "home",
    ),
    { recursive: true },
  );

  const gid = process.getgid?.() ?? uid;
  const processHandle = Bun.spawn(
    [
      "chown",
      "-R",
      `${uid.toString()}:${gid.toString()}`,
      input.sessionHome,
      input.workspacePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) {
    const detail = await new Response(processHandle.stderr).text();
    throw new Error(
      `Failed to prepare provider-owned chat directories: ${detail.trim()}`,
    );
  }
}

export type RunAgentChatTurnDependencies = {
  store: AgentChatObjectStore;
  bundlePrefix: string;
  baseDirectory: string;
  sourceEnv: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  redactTokens: readonly (string | undefined)[];
  forbiddenSessionTokens: readonly string[];
  beforeEvent: () => Promise<boolean>;
  heartbeat: (details: Record<string, unknown>) => void;
  heartbeatIntervalMs?: number;
  now: () => Date;
  runTurn: typeof runAgentTurn;
};

export async function runAgentChatTurnWithDependencies(
  rawInput: RunAgentChatTurnInput,
  dependencies: RunAgentChatTurnDependencies,
): Promise<AgentChatTurnResult> {
  const input = RunAgentChatTurnInputSchema.parse(rawInput);
  const paths = sessionPaths(dependencies.baseDirectory, input.config.chatId);
  await rm(paths.root, { recursive: true, force: true });
  await Promise.all([
    mkdir(paths.sessionHome, { recursive: true }),
    mkdir(paths.workspacePath, { recursive: true }),
  ]);
  let phase = "prepare";
  const heartbeat = (): void => {
    dependencies.heartbeat({ phase, turn: input.turnNumber });
  };
  heartbeat();
  const heartbeatTimer = setInterval(
    heartbeat,
    dependencies.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
  );

  try {
    if (input.providerSessionId !== undefined) {
      if (input.priorSessionManifestKey === undefined) {
        throw new Error(
          "A resumed agent chat is missing its session manifest key",
        );
      }
      phase = "hydrate";
      heartbeat();
      await pullLatestAgentChatSessionBundle({
        store: dependencies.store,
        prefix: dependencies.bundlePrefix,
        chatId: input.config.chatId,
        provider: input.config.provider,
        providerSessionId: input.providerSessionId,
        manifestKey: input.priorSessionManifestKey,
        expectedTurnNumber: input.turnNumber - 1,
        workspacePath: paths.workspacePath,
        sessionHome: paths.sessionHome,
      });
    }

    const env = providerEnvironment({
      provider: input.config.provider,
      sessionHome: paths.sessionHome,
      sourceEnv: dependencies.sourceEnv,
    });
    await prepareProviderRuntime({
      provider: input.config.provider,
      sessionHome: paths.sessionHome,
      workspacePath: paths.workspacePath,
      sourceEnv: dependencies.sourceEnv,
    });
    phase = "provider";
    heartbeat();
    const common = {
      service: "temporal",
      callSite: "agent-chat",
      prompt: input.request.prompt,
      model: input.config.model,
      maxTurns: input.config.maxTurnsPerMessage,
      cwd: paths.workspacePath,
      env,
      signal: dependencies.signal,
      requireFinalText: true,
      captureEvidenceEvents: false,
      ...(input.providerSessionId === undefined
        ? {}
        : { resumeSessionId: input.providerSessionId }),
      redactTokens: dependencies.redactTokens,
      beforeEvent: dependencies.beforeEvent,
      onEvent: (event: { type: string; elapsedMs: number; idleMs: number }) => {
        dependencies.heartbeat({
          phase: "provider",
          turn: input.turnNumber,
          eventType: event.type,
          elapsedMs: event.elapsedMs,
          idleMs: event.idleMs,
        });
      },
      warn: (message: string) => {
        console.warn(message);
      },
      errorMessagePrefix: `${input.config.provider} durable chat turn failed`,
    };
    const outcome =
      input.config.provider === "codex"
        ? await dependencies.runTurn({
            provider: "codex",
            ...common,
            auth: {
              kind: "chatgpt-subscription",
              authJson: Buffer.from(
                requiredEnvironment(
                  dependencies.sourceEnv,
                  "CODEX_AUTH_JSON_B64",
                ),
                "base64",
              ).toString("utf8"),
            },
            sandboxPolicy: {
              sandboxMode: "workspace-write",
              networkAccessEnabled: true,
              webSearchMode: "live",
            },
            turnBudgetKind: "tool-steps",
            skipGitRepoCheck: true,
          })
        : await dependencies.runTurn({
            provider: "claude",
            ...common,
            ...(input.providerSessionId === undefined
              ? {}
              : {
                  resumeWorkspacePath: paths.workspacePath,
                }),
            auth: {
              kind: "claude-subscription",
              oauthToken: requiredEnvironment(
                dependencies.sourceEnv,
                "CLAUDE_CODE_OAUTH_TOKEN",
              ),
            },
            permissionPolicy: "acceptEdits",
          });
    if (outcome.finalText === undefined || outcome.sessionId === undefined) {
      throw new Error(
        `${input.config.provider} durable chat completed without final text or a session id`,
      );
    }

    phase = "persist";
    heartbeat();
    const published = await pushAgentChatSessionBundle({
      store: dependencies.store,
      prefix: dependencies.bundlePrefix,
      chatId: input.config.chatId,
      provider: input.config.provider,
      turnNumber: input.turnNumber,
      turnId: input.request.turnId,
      providerSessionId: outcome.sessionId,
      workspacePath: paths.workspacePath,
      sessionHome: paths.sessionHome,
      forbiddenTokens: [
        ...dependencies.forbiddenSessionTokens,
        ...agentTaskProviderSecretTokens(dependencies.sourceEnv),
      ],
    });
    return AgentChatTurnResultSchema.parse({
      turnId: input.request.turnId,
      turnNumber: input.turnNumber,
      finalText: outcome.finalText,
      providerSessionId: outcome.sessionId,
      sessionManifestKey: published.manifestKey,
      completedAt: dependencies.now().toISOString(),
      usage: outcome.usage,
    });
  } finally {
    clearInterval(heartbeatTimer);
    await rm(paths.root, { recursive: true, force: true });
  }
}

export async function runAgentChatTurn(
  input: RunAgentChatTurnInput,
): Promise<AgentChatTurnResult> {
  const context = Context.current();
  const secretState = await createAgentTaskSecretTokenState(undefined);
  const env = Bun.env;
  return await runAgentChatTurnWithDependencies(input, {
    store: createAgentChatS3Store({
      endpoint: requiredEnvironment(env, "S3_ENDPOINT"),
      region: AGENT_CHAT_RUNTIME_CONFIG.region,
      bucket: AGENT_CHAT_RUNTIME_CONFIG.bucket,
      accessKeyId: requiredEnvironment(env, "AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment(env, "AWS_SECRET_ACCESS_KEY"),
    }),
    bundlePrefix: AGENT_CHAT_RUNTIME_CONFIG.bundlePrefix,
    baseDirectory: AGENT_CHAT_RUNTIME_CONFIG.runtimeRoot,
    sourceEnv: env,
    signal: context.cancellationSignal,
    redactTokens: secretState.tokens,
    forbiddenSessionTokens: secretState.mountedTokens,
    beforeEvent: async () => {
      try {
        await secretState.refresh();
        return true;
      } catch {
        return false;
      }
    },
    heartbeat: (details) => {
      context.heartbeat(details);
    },
    now: () => new Date(),
    runTurn: runAgentTurn,
  });
}

export const agentChatActivities = { runAgentChatTurn };
