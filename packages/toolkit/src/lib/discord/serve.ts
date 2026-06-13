import { appendFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client as BotClient, Events, GatewayIntentBits } from "discord.js";
import { Client as UserClient } from "discord.js-selfbot-v13";
import {
  type DaemonContext,
  identities,
  leaveVoice,
  routeRequest,
} from "#lib/discord/handlers.ts";
import {
  type DaemonState,
  DEFAULT_TTL_SECONDS,
  DISCORD_DIR,
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
} from "#lib/discord/ipc.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logLine(msg: string, extra: Record<string, unknown> = {}): void {
  const day = new Date().toISOString().slice(0, 10);
  const line = `${JSON.stringify({ ts: new Date().toISOString(), msg, ...extra })}\n`;
  void appendFile(path.join(LOGS_DIR, `daemon-${day}.log`), line);
}

function waitForReady(
  client: { once: (event: string, fn: () => void) => unknown },
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} client not ready after 30s`));
    }, 30_000);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function loginBot(token: string): Promise<BotClient> {
  const bot = new BotClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  bot.on(Events.Error, (error) => {
    logLine("bot client error", { error: getErrorMessage(error) });
  });
  const ready = waitForReady(bot, "bot");
  await bot.login(token);
  await ready;
  logLine("bot ready", { tag: bot.user?.tag });
  return bot;
}

async function loginUser(token: string): Promise<UserClient> {
  const user = new UserClient();
  user.on("error", (error) => {
    logLine("user client error", { error: getErrorMessage(error) });
  });
  const ready = waitForReady(user, "user");
  await user.login(token);
  await ready;
  logLine("user ready", { tag: user.user?.tag });
  return user;
}

export async function runDiscordDaemon(): Promise<void> {
  const botToken = Bun.env["DISCORD_BOT_TOKEN"];
  const userToken = Bun.env["DISCORD_USER_TOKEN"];
  const hasBot = botToken != null && botToken.length > 0;
  const hasUser = userToken != null && userToken.length > 0;
  if (!hasBot && !hasUser) {
    throw new Error(
      "At least one of DISCORD_BOT_TOKEN / DISCORD_USER_TOKEN must be set",
    );
  }
  const ttlRaw = Bun.env["TOOLKIT_DISCORD_TTL_SECONDS"];
  const ttlSeconds =
    ttlRaw != null && ttlRaw.length > 0
      ? Number.parseInt(ttlRaw, 10)
      : DEFAULT_TTL_SECONDS;

  await mkdir(LOGS_DIR, { recursive: true });

  try {
    await startDaemon({ botToken, userToken, hasBot, hasUser, ttlSeconds });
  } catch (error) {
    logLine("fatal startup error", { error: getErrorMessage(error) });
    throw error;
  }
}

async function startDaemon(opts: {
  botToken: string | undefined;
  userToken: string | undefined;
  hasBot: boolean;
  hasUser: boolean;
  ttlSeconds: number;
}): Promise<void> {
  const { botToken, userToken, hasBot, hasUser, ttlSeconds } = opts;
  const ctx: DaemonContext = {
    bot: hasBot && botToken != null ? await loginBot(botToken) : null,
    user: hasUser && userToken != null ? await loginUser(userToken) : null,
    voice: null,
    startedAt: new Date().toISOString(),
    ttlSeconds,
    lastActivity: Date.now(),
  };

  await rm(SOCKET_PATH, { force: true });

  let shuttingDown = false;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logLine("shutting down", { reason });
    leaveVoice(ctx);
    if (ctx.user !== null) {
      try {
        ctx.user.destroy();
      } catch (error) {
        logLine("user destroy failed", { error: getErrorMessage(error) });
      }
    }
    if (ctx.bot !== null) {
      await ctx.bot.destroy();
    }
    await server.stop(true);
    if (idleTimer !== null) {
      clearInterval(idleTimer);
    }
    await rm(SOCKET_PATH, { force: true });
    await rm(STATE_PATH, { force: true });
    process.exit(0);
  };

  const server = Bun.serve({
    unix: SOCKET_PATH,
    fetch(request): Promise<Response> | Response {
      const url = new URL(request.url);
      if (url.pathname === "/shutdown") {
        setTimeout(() => {
          void shutdown("shutdown requested");
        }, 50);
        return Response.json({ ok: true });
      }
      return routeRequest(ctx, url, request);
    },
  });
  await chmod(SOCKET_PATH, 0o600);

  idleTimer = setInterval(() => {
    if (Date.now() - ctx.lastActivity > ttlSeconds * 1000) {
      void shutdown(`idle TTL of ${String(ttlSeconds)}s reached`);
    }
  }, 30_000);

  const state: DaemonState = {
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds,
    identities: identities(ctx),
  };
  await mkdir(DISCORD_DIR, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logLine("daemon listening", {
    socket: SOCKET_PATH,
    ttlSeconds,
    identities: identities(ctx),
  });
}
