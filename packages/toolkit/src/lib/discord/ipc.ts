import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// Filesystem layout for the session-scoped daemon. The socket lives in the
// user's home dir with 0600 perms; tokens never touch disk.
export const DISCORD_DIR = path.join(os.homedir(), ".toolkit", "discord");
export const SOCKET_PATH = path.join(DISCORD_DIR, "daemon.sock");
export const STATE_PATH = path.join(DISCORD_DIR, "state.json");
export const LOGS_DIR = path.join(DISCORD_DIR, "logs");

export const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

// Bun.file(path).exists() returns false for a unix socket (it is not a regular
// file), so use stat to test the daemon socket and state files.
export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export const IdentityKindSchema = z.enum(["bot", "user"]);
export type IdentityKind = z.infer<typeof IdentityKindSchema>;

export const IdentitySchema = z.object({
  id: z.string(),
  tag: z.string(),
});

export const DaemonStateSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  ttlSeconds: z.number(),
  identities: z.object({
    bot: IdentitySchema.optional(),
    user: IdentitySchema.optional(),
  }),
});
export type DaemonState = z.infer<typeof DaemonStateSchema>;

export const EmbedSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  fields: z.array(z.object({ name: z.string(), value: z.string() })),
});

export const MessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorId: z.string(),
  authorTag: z.string(),
  authorIsBot: z.boolean(),
  content: z.string(),
  createdAt: z.string(),
  embeds: z.array(EmbedSchema),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })),
});
export type IpcMessage = z.infer<typeof MessageSchema>;

export const StatusResponseSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  ttlSeconds: z.number(),
  idleSeconds: z.number(),
  identities: z.object({
    bot: IdentitySchema.optional(),
    user: IdentitySchema.optional(),
  }),
  voice: z.object({ guildId: z.string(), channelId: z.string() }).nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const SendRequestSchema = z.object({
  channelId: z.string(),
  content: z.string(),
  as: IdentityKindSchema.optional(),
});
export const SendResponseSchema = z.object({
  messageId: z.string(),
  as: IdentityKindSchema,
});

export const ReadRequestSchema = z.object({
  channelId: z.string(),
  limit: z.number().int().min(1).max(100),
});
export const ReadResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

export const WaitRequestSchema = z.object({
  channelId: z.string(),
  fromUserId: z.string().optional(),
  contains: z.string().optional(),
  timeoutSeconds: z.number().int().min(1).max(600),
});
export const WaitResponseSchema = z.object({
  message: MessageSchema.nullable(),
  timedOut: z.boolean(),
});

export const SlashRequestSchema = z.object({
  channelId: z.string(),
  botId: z.string(),
  command: z.string(),
  args: z.array(z.string()),
});
export const SlashResponseSchema = z.object({
  invoked: z.boolean(),
  reply: MessageSchema.nullable(),
});

export const VoiceJoinRequestSchema = z.object({
  channelId: z.string(),
});
export const VoiceJoinResponseSchema = z.object({
  guildId: z.string(),
  channelId: z.string(),
});

export const VoiceLeaveResponseSchema = z.object({
  left: z.boolean(),
});

export const VoiceStateSchema = z.object({
  userId: z.string(),
  userTag: z.string().nullable(),
  channelId: z.string().nullable(),
  streaming: z.boolean(),
  selfVideo: z.boolean(),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
});
export const VoiceStatesResponseSchema = z.object({
  states: z.array(VoiceStateSchema),
});

export const GuildInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export const GuildsResponseSchema = z.object({
  bot: z.array(GuildInfoSchema),
  user: z.array(GuildInfoSchema),
});

export const ChannelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentName: z.string().nullable(),
});
export const ChannelsResponseSchema = z.object({
  channels: z.array(ChannelInfoSchema),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export function parseTtl(raw: string): number {
  const match = /^(\d+)([smh]?)$/.exec(raw.trim());
  if (match === null) {
    throw new Error(
      `Invalid TTL "${raw}" — use a number with optional s/m/h suffix, e.g. 90m or 4h`,
    );
  }
  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2] ?? "";
  const multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return value * multiplier;
}
