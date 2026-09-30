import * as Sentry from "@sentry/bun";
import type { Client as TemporalClient } from "@temporalio/client";
import {
  startAgentChatDiscordBot,
  type AgentChatDiscordHandle,
} from "./agent-chat-discord-bot.ts";

const COMPONENT = "agent-chat-discord";
const DISCORD_RETRY_INITIAL_DELAY_MS = 1000;
const DISCORD_RETRY_MAX_DELAY_MS = 60_000;

type AgentChatDiscordStarter = (
  temporal: TemporalClient,
  signal: AbortSignal,
) => Promise<AgentChatDiscordHandle | undefined>;

export type AgentChatDiscordSupervisorDependencies = {
  start: AgentChatDiscordStarter;
  initialRetryDelayMs: number;
  maximumRetryDelayMs: number;
};

function jsonLog(message: string, fields: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      level: "error",
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}

function abortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

function waitForDiscordRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (abortRequested(signal)) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
    if (abortRequested(signal)) {
      finish();
      return;
    }
  });
}

const defaultDiscordSupervisorDependencies: AgentChatDiscordSupervisorDependencies =
  {
    start: startAgentChatDiscordBot,
    initialRetryDelayMs: DISCORD_RETRY_INITIAL_DELAY_MS,
    maximumRetryDelayMs: DISCORD_RETRY_MAX_DELAY_MS,
  };

export function startAgentChatDiscordSupervisor(
  temporal: TemporalClient,
  dependencies: AgentChatDiscordSupervisorDependencies = defaultDiscordSupervisorDependencies,
): AgentChatDiscordHandle {
  const controller = new AbortController();
  let active: AgentChatDiscordHandle | undefined;
  let closed = false;
  const startup = (async () => {
    let delayMs = dependencies.initialRetryDelayMs;
    while (!abortRequested(controller.signal)) {
      try {
        const started = await dependencies.start(temporal, controller.signal);
        if (started === undefined) return;
        if (abortRequested(controller.signal)) {
          await started.close();
          return;
        }
        active = started;
        return;
      } catch (error: unknown) {
        if (abortRequested(controller.signal)) return;
        Sentry.captureException(error);
        jsonLog("Discord ingress startup failed; retrying", {
          retryDelayMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await waitForDiscordRetry(delayMs, controller.signal);
        delayMs = Math.min(delayMs * 2, dependencies.maximumRetryDelayMs);
      }
    }
  })();

  return {
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      await startup;
      await active?.close();
    },
  };
}
