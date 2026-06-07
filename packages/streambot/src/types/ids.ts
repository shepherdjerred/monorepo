import { z } from "zod";

/** Discord snowflake shape — 17-20 digits. */
const SNOWFLAKE = /^\d{17,20}$/u;
const snowflake = (label: string) =>
  z
    .string()
    .regex(SNOWFLAKE, `${label} must be a Discord snowflake (17-20 digits)`);

/**
 * Branded ids and secrets. Branding keeps a `GuildId` from being accidentally passed where a
 * `ChannelId` (or a raw `string`) is expected, and forces values to be parsed at the boundary
 * (config load, interaction handling) rather than cast. A branded string is still structurally a
 * `string`, so it passes straight to discord.js / `@dank074` APIs that want `string`.
 */
export const GuildIdSchema = snowflake("guild id").brand<"GuildId">();
export type GuildId = z.infer<typeof GuildIdSchema>;

export const ChannelIdSchema = snowflake("channel id").brand<"ChannelId">();
export type ChannelId = z.infer<typeof ChannelIdSchema>;

export const UserIdSchema = snowflake("user id").brand<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;

export const BotTokenSchema = z.string().min(1).brand<"BotToken">();
export type BotToken = z.infer<typeof BotTokenSchema>;

export const UserTokenSchema = z.string().min(1).brand<"UserToken">();
export type UserToken = z.infer<typeof UserTokenSchema>;

/** Parse an arbitrary string to a {@link UserId} (e.g. `interaction.user.id`), throwing if invalid. */
export function toUserId(value: string): UserId {
  return UserIdSchema.parse(value);
}

/** Parse an arbitrary string to a {@link ChannelId}, throwing if invalid. */
export function toChannelId(value: string): ChannelId {
  return ChannelIdSchema.parse(value);
}
