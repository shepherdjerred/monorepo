/**
 * Zod shapes for the Discord REST payloads the web request path reads with the
 * BOT token.
 *
 * These mirror Discord's wire format (snake_case, permission bitfields as
 * decimal strings) rather than discord.js's structure classes on purpose: the
 * whole point of reading them over REST is that no gateway connection — and so
 * no discord.js cache — has to exist for a web request to be answered.
 *
 * Every field kept here is one a web-serving code path actually reads. Discord
 * sends far more; unknown keys are ignored rather than rejected so a Discord
 * addition never fails a permission check.
 */

import { z } from "zod";

/**
 * A channel permission overwrite. `allow`/`deny` are decimal bitfield strings;
 * `type` is 0 for a role and 1 for a member.
 */
export const DiscordOverwriteSchema = z.object({
  id: z.string(),
  type: z.number(),
  allow: z.string(),
  deny: z.string(),
});
export type DiscordOverwrite = z.infer<typeof DiscordOverwriteSchema>;

export const DiscordGuildChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.number(),
  parent_id: z.string().nullish(),
  permission_overwrites: z.array(DiscordOverwriteSchema).default([]),
});
export type DiscordGuildChannel = z.infer<typeof DiscordGuildChannelSchema>;
export const DiscordGuildChannelsSchema = z.array(DiscordGuildChannelSchema);

export const DiscordRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.string(),
});
export type DiscordRole = z.infer<typeof DiscordRoleSchema>;
export const DiscordRolesSchema = z.array(DiscordRoleSchema);

export const DiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  /** The new display name. Absent/null for accounts that never set one. */
  global_name: z.string().nullish(),
  /** `"0"` for migrated accounts; a legacy four-digit tag otherwise. */
  discriminator: z.string().nullish(),
  avatar: z.string().nullish(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const DiscordGuildMemberSchema = z.object({
  user: DiscordUserSchema,
  nick: z.string().nullish(),
  /** Per-guild avatar override, distinct from `user.avatar`. */
  avatar: z.string().nullish(),
  roles: z.array(z.string()).default([]),
});
export type DiscordGuildMember = z.infer<typeof DiscordGuildMemberSchema>;
export const DiscordGuildMembersSchema = z.array(DiscordGuildMemberSchema);

/**
 * A channel fetched by id rather than through its guild's channel list, so the
 * guild it belongs to has to come back with it.
 */
export const DiscordChannelSchema = DiscordGuildChannelSchema.extend({
  guild_id: z.string().nullish(),
});
export type DiscordChannel = z.infer<typeof DiscordChannelSchema>;

export const DiscordGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_id: z.string(),
});
export type DiscordGuildSummary = z.infer<typeof DiscordGuildSchema>;
