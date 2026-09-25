import type { ThreadEvent } from "@openai/codex-sdk";
import { redactSecrets } from "#shared/redact.ts";
import type { RunCodexAgentTurnInput } from "#lib/agent-runner/contract.ts";
import { drainStderr, readRpcMessages } from "./transport.ts";
import { appServerNotification, type AppServerEventState } from "./events.ts";
import {
  codexSubscriptionTokens,
  handshakeResponse,
  rejectServerRequest,
} from "./protocol.ts";

function safeErrorCause(
  error: unknown,
  secrets: readonly (string | undefined)[],
) {
  if (!(error instanceof Error)) return redactSecrets(String(error), secrets);
  return {
    name: "CodexAppServerError",
    message: redactSecrets(error.message, secrets),
    stack:
      error.stack === undefined
        ? undefined
        : redactSecrets(error.stack, secrets),
  };
}

function redactedProtocolFailure(
  error: unknown,
  secrets: readonly (string | undefined)[],
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  // Retain the diagnostic cause without retaining a credential-bearing Error object.
  return new Error(redactSecrets(detail, secrets), {
    cause: safeErrorCause(error, secrets),
  });
}

async function captureStderr(stream: ReadableStream<Uint8Array>) {
  try {
    await drainStderr(stream);
    return { ok: true as const };
  } catch (error: unknown) {
    return { ok: false as const, error };
  }
}

export async function* runSubscriptionCodexEvents(input: {
  run: RunCodexAgentTurnInput;
  command: readonly string[];
  environment: Record<string, string>;
  authJson: string;
  excludedKeys: readonly string[];
  onExecutionState: (possiblyAppliedEffects: boolean) => void;
}): AsyncGenerator<ThreadEvent> {
  const auth = codexSubscriptionTokens(input.authJson);
  const secrets = [
    ...(input.run.redactTokens ?? []),
    input.authJson,
    auth.access_token,
    auth.refresh_token,
    auth.id_token,
  ];
  input.run.signal.throwIfAborted();
  const child = Bun.spawn(
    [
      ...input.command,
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'cli_auth_credentials_store="ephemeral"',
      "-c",
      "allow_login_shell=false",
      "-c",
      'shell_environment_policy.inherit="all"',
      "-c",
      `shell_environment_policy.exclude=${JSON.stringify(input.excludedKeys)}`,
      "-c",
      "shell_environment_policy.experimental_use_profile=false",
    ],
    {
      cwd: input.run.cwd,
      env: input.environment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stderr = captureStderr(child.stderr);
  const kill = (): void => {
    child.kill();
  };
  input.run.signal.addEventListener("abort", kill, { once: true });
  const send = async (message: unknown): Promise<void> => {
    await child.stdin.write(`${JSON.stringify(message)}\n`);
    await child.stdin.flush();
  };
  const state: AppServerEventState = {
    threadId: undefined,
    toolSteps: 0,
    completed: false,
    usage: {
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
    },
  };
  let failure: { cause: unknown } | undefined;
  try {
    await send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "temporal_agent_chat", version: "1" },
        capabilities: { experimentalApi: true },
      },
    });
    let expectedResponse = 1;
    for await (const message of readRpcMessages(child.stdout)) {
      input.run.signal.throwIfAborted();
      if (message.method === undefined) {
        yield* handshakeResponse({
          ...input,
          message,
          expectedResponse,
          auth,
          state,
          send,
        });
        expectedResponse += 1;
        continue;
      }
      if (message.id !== undefined) await rejectServerRequest(message, send);
      const event = appServerNotification({
        message,
        state,
        maxTurns: input.run.maxTurns,
        turnBudgetKind: input.run.turnBudgetKind,
        onExecutionState: input.onExecutionState,
      });
      if (event !== undefined) yield event;
      if (state.completed) break;
    }
    if (!state.completed)
      throw new Error(
        `Codex App Server closed before completion (exit ${String(await child.exited)})`,
      );
  } catch (error: unknown) {
    failure = { cause: redactedProtocolFailure(error, secrets) };
  } finally {
    input.run.signal.removeEventListener("abort", kill);
    child.kill();
    await child.exited;
    const stderrFailure = await stderr;
    if (!stderrFailure.ok)
      failure ??= {
        cause: redactedProtocolFailure(stderrFailure.error, secrets),
      };
  }
  if (failure !== undefined) throw failure.cause;
}
