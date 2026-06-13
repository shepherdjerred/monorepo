import {
  ChannelType,
  type Client as BotClient,
  Events,
  type Message as BotMessage,
} from "discord.js";
import {
  type Client as UserClient,
  Message as UserMessage,
} from "discord.js-selfbot-v13";
import {
  ReadRequestSchema,
  SendRequestSchema,
  SlashRequestSchema,
  type IdentityKind,
  type IpcMessage,
  type StatusResponse,
  VoiceJoinRequestSchema,
  WaitRequestSchema,
} from "#lib/discord/ipc.ts";

export type VoicePresence = { guildId: string; channelId: string };

export type DaemonContext = {
  bot: BotClient | null;
  user: UserClient | null;
  voice: VoicePresence | null;
  startedAt: string;
  ttlSeconds: number;
  lastActivity: number;
};

export class DaemonError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapBotMessage(message: BotMessage): IpcMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    authorIsBot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    embeds: message.embeds.map((embed) => ({
      title: embed.title,
      description: embed.description,
      fields: embed.fields.map((field) => ({
        name: field.name,
        value: field.value,
      })),
    })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
    })),
  };
}

function mapUserMessage(message: UserMessage): IpcMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    authorIsBot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description ?? null,
      fields: embed.fields.map((field) => ({
        name: field.name,
        value: field.value,
      })),
    })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name ?? "attachment",
      url: attachment.url,
    })),
  };
}

export function identities(ctx: DaemonContext): StatusResponse["identities"] {
  const result: StatusResponse["identities"] = {};
  const bot = ctx.bot?.user;
  if (bot != null) {
    result.bot = { id: bot.id, tag: bot.tag };
  }
  const user = ctx.user?.user;
  if (user != null) {
    result.user = { id: user.id, tag: user.tag };
  }
  return result;
}

export function buildStatus(ctx: DaemonContext): StatusResponse {
  return {
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds: ctx.ttlSeconds,
    idleSeconds: Math.round((Date.now() - ctx.lastActivity) / 1000),
    identities: identities(ctx),
    voice: ctx.voice,
  };
}

async function requireBotChannel(ctx: DaemonContext, channelId: string) {
  if (ctx.bot === null) {
    throw new DaemonError(
      "This command needs a bot identity (DISCORD_BOT_TOKEN)",
    );
  }
  const channel = await ctx.bot.channels.fetch(channelId);
  if (channel?.isTextBased() === true) {
    return channel;
  }
  throw new DaemonError(`Channel ${channelId} is not a bot text channel`);
}

async function requireUserChannel(ctx: DaemonContext, channelId: string) {
  if (ctx.user === null) {
    throw new DaemonError(
      "This command needs a userbot identity (DISCORD_USER_TOKEN)",
    );
  }
  const channel = await ctx.user.channels.fetch(channelId);
  if (channel?.isText() === true) {
    return channel;
  }
  throw new DaemonError(`Channel ${channelId} is not a userbot text channel`);
}

async function handleSend(ctx: DaemonContext, body: unknown): Promise<unknown> {
  const request = SendRequestSchema.parse(body);
  const as: IdentityKind = request.as ?? (ctx.bot === null ? "user" : "bot");
  if (as === "bot") {
    const channel = await requireBotChannel(ctx, request.channelId);
    if ("send" in channel) {
      const sent = await channel.send(request.content);
      return { messageId: sent.id, as };
    }
    throw new DaemonError(`Channel ${request.channelId} is not sendable`);
  }
  const channel = await requireUserChannel(ctx, request.channelId);
  const sent = await channel.send(request.content);
  return { messageId: sent.id, as };
}

async function handleRead(ctx: DaemonContext, body: unknown): Promise<unknown> {
  const request = ReadRequestSchema.parse(body);
  if (ctx.bot !== null) {
    const channel = await requireBotChannel(ctx, request.channelId);
    const fetched = await channel.messages.fetch({ limit: request.limit });
    const messages = [...fetched.values()]
      .toSorted((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => mapBotMessage(message));
    return { messages };
  }
  const channel = await requireUserChannel(ctx, request.channelId);
  const fetched = await channel.messages.fetch({ limit: request.limit });
  const messages = [...fetched.values()]
    .toSorted((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => mapUserMessage(message));
  return { messages };
}

function messageMatches(
  message: IpcMessage,
  request: {
    channelId: string;
    fromUserId?: string | undefined;
    contains?: string | undefined;
  },
): boolean {
  if (message.channelId !== request.channelId) {
    return false;
  }
  if (request.fromUserId != null && message.authorId !== request.fromUserId) {
    return false;
  }
  if (request.contains == null) {
    return true;
  }
  const haystack = [
    message.content,
    ...message.embeds.flatMap((embed) => [
      embed.title ?? "",
      embed.description ?? "",
    ]),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(request.contains.toLowerCase());
}

function handleWait(ctx: DaemonContext, body: unknown): Promise<unknown> {
  const request = WaitRequestSchema.parse(body);
  return new Promise((resolve) => {
    const cleanups: (() => void)[] = [];
    const finish = (message: IpcMessage | null): void => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      ctx.lastActivity = Date.now();
      resolve({ message, timedOut: message === null });
    };
    const timer = setTimeout(() => {
      finish(null);
    }, request.timeoutSeconds * 1000);
    cleanups.push(() => {
      clearTimeout(timer);
    });
    if (ctx.bot !== null) {
      const bot = ctx.bot;
      const listener = (message: BotMessage): void => {
        const mapped = mapBotMessage(message);
        if (messageMatches(mapped, request)) {
          finish(mapped);
        }
      };
      bot.on(Events.MessageCreate, listener);
      cleanups.push(() => {
        bot.off(Events.MessageCreate, listener);
      });
    } else if (ctx.user === null) {
      finish(null);
    } else {
      const user = ctx.user;
      const listener = (message: UserMessage): void => {
        const mapped = mapUserMessage(message);
        if (messageMatches(mapped, request)) {
          finish(mapped);
        }
      };
      user.on("messageCreate", listener);
      cleanups.push(() => {
        user.off("messageCreate", listener);
      });
    }
  });
}

async function handleSlash(
  ctx: DaemonContext,
  body: unknown,
): Promise<unknown> {
  const request = SlashRequestSchema.parse(body);
  const channel = await requireUserChannel(ctx, request.channelId);
  const result = await channel.sendSlash(
    request.botId,
    request.command,
    ...request.args,
  );
  const reply = result instanceof UserMessage ? mapUserMessage(result) : null;
  return { invoked: true, reply };
}

async function handleVoiceJoin(
  ctx: DaemonContext,
  body: unknown,
): Promise<unknown> {
  const request = VoiceJoinRequestSchema.parse(body);
  if (ctx.user === null) {
    throw new DaemonError(
      "voice join needs a userbot identity (DISCORD_USER_TOKEN)",
    );
  }
  const channel = await ctx.user.channels.fetch(request.channelId);
  if (channel?.isVoice() !== true) {
    throw new DaemonError(
      `Channel ${request.channelId} is not a guild voice channel`,
    );
  }
  const guildId = channel.guildId;
  // Gateway presence-only join (op 4) — no media handshake. The selfbot's
  // built-in joinChannel negotiates deprecated voice encryption and times out.
  ctx.user.ws.broadcast({
    op: 4,
    d: {
      guild_id: guildId,
      channel_id: request.channelId,
      self_mute: true,
      self_deaf: false,
      self_video: false,
    },
  });
  ctx.voice = { guildId, channelId: request.channelId };
  return { guildId, channelId: request.channelId };
}

export function leaveVoice(ctx: DaemonContext): { left: boolean } {
  if (ctx.user === null || ctx.voice === null) {
    return { left: false };
  }
  ctx.user.ws.broadcast({
    op: 4,
    d: {
      guild_id: ctx.voice.guildId,
      channel_id: null,
      self_mute: true,
      self_deaf: false,
      self_video: false,
    },
  });
  ctx.voice = null;
  return { left: true };
}

async function handleVoiceStates(
  ctx: DaemonContext,
  guildId: string,
): Promise<unknown> {
  if (ctx.bot === null) {
    throw new DaemonError(
      "voice states needs a bot identity (DISCORD_BOT_TOKEN)",
    );
  }
  const guild = await ctx.bot.guilds.fetch(guildId);
  const states = [...guild.voiceStates.cache.values()].map((state) => ({
    userId: state.id,
    userTag: state.member?.user.tag ?? null,
    channelId: state.channelId,
    streaming: state.streaming === true,
    selfVideo: state.selfVideo === true,
    selfMute: state.selfMute === true,
    selfDeaf: state.selfDeaf === true,
  }));
  return { states };
}

function handleGuilds(ctx: DaemonContext): unknown {
  const botGuilds =
    ctx.bot === null
      ? []
      : [...ctx.bot.guilds.cache.values()].map((guild) => ({
          id: guild.id,
          name: guild.name,
        }));
  const userGuilds =
    ctx.user === null
      ? []
      : [...ctx.user.guilds.cache.values()].map((guild) => ({
          id: guild.id,
          name: guild.name,
        }));
  return { bot: botGuilds, user: userGuilds };
}

async function handleChannels(
  ctx: DaemonContext,
  guildId: string,
): Promise<unknown> {
  if (ctx.bot !== null) {
    const guild = await ctx.bot.guilds.fetch(guildId);
    const fetched = await guild.channels.fetch();
    const channels = [...fetched.values()]
      .filter((channel) => channel !== null)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: ChannelType[channel.type],
        parentName: channel.parent?.name ?? null,
      }));
    return { channels };
  }
  if (ctx.user !== null) {
    const guild = await ctx.user.guilds.fetch(guildId);
    const channels = [...guild.channels.cache.values()].map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentName: channel.parent?.name ?? null,
    }));
    return { channels };
  }
  throw new DaemonError("no identity available");
}

// Route a daemon request to the right handler and return a JSON Response.
// /status and /shutdown are handled by the caller (they need server control).
export async function routeRequest(
  ctx: DaemonContext,
  url: URL,
  request: Request,
): Promise<Response> {
  ctx.lastActivity = Date.now();
  try {
    const result = await dispatch(ctx, url, request);
    ctx.lastActivity = Date.now();
    return Response.json(result);
  } catch (error) {
    const status = error instanceof DaemonError ? error.status : 500;
    return Response.json({ error: getErrorMessage(error) }, { status });
  }
}

async function dispatch(
  ctx: DaemonContext,
  url: URL,
  request: Request,
): Promise<unknown> {
  switch (url.pathname) {
    case "/status":
      return buildStatus(ctx);
    case "/send":
      return handleSend(ctx, await request.json());
    case "/read":
      return handleRead(ctx, await request.json());
    case "/wait":
      return handleWait(ctx, await request.json());
    case "/slash":
      return handleSlash(ctx, await request.json());
    case "/voice/join":
      return handleVoiceJoin(ctx, await request.json());
    case "/voice/leave":
      return leaveVoice(ctx);
    case "/voice/states":
      return handleVoiceStates(ctx, requireGuildId(url));
    case "/guilds":
      return handleGuilds(ctx);
    case "/channels":
      return handleChannels(ctx, requireGuildId(url));
    default:
      throw new DaemonError(`Unknown path ${url.pathname}`, 404);
  }
}

function requireGuildId(url: URL): string {
  const guildId = url.searchParams.get("guildId");
  if (guildId === null) {
    throw new DaemonError("guildId query param is required");
  }
  return guildId;
}
