import { mkdir } from "node:fs/promises";
import {
  jsonlLogger,
  serveUnixDaemon,
} from "@shepherdjerred/unix-socket-daemon";
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
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
} from "#lib/discord/ipc.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const logLine = jsonlLogger(LOGS_DIR);

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

  const state: DaemonState = {
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds,
    identities: identities(ctx),
  };
  await serveUnixDaemon({
    socketPath: SOCKET_PATH,
    statePath: STATE_PATH,
    state,
    ttlSeconds,
    lastActivity: () => ctx.lastActivity,
    handle: (url, request) => routeRequest(ctx, url, request),
    onShutdown: async () => {
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
    },
    log: logLine,
  });

  logLine("daemon listening", {
    socket: SOCKET_PATH,
    ttlSeconds,
    identities: identities(ctx),
  });
}
