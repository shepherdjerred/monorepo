import type { Client as UserClient } from "discord.js-selfbot-v13";
import { z } from "zod/v4";
import { userChannelInfo } from "#lib/discord/channel.ts";
import { DaemonError } from "#lib/discord/error.ts";

// The installed SDK exposes its route builder as unknown in TypeScript.
// Validate each callable rather than asserting a wider REST client type.
const Route = z.custom<(...parts: string[]) => unknown>(
  (value) => typeof value === "function",
);
function property(route: unknown, name: string) {
  return Route.parse(Reflect.get(Route.parse(route), name));
}
const IndexPermissions = z.object({
  user: z.boolean().optional(),
  roles: z.record(z.string(), z.boolean()).optional(),
  channels: z.record(z.string(), z.boolean()).optional(),
});
export const ApplicationCommandIndex = z.object({
  applications: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      permissions: IndexPermissions.optional(),
    }),
  ),
  application_commands: z.array(
    z.object({
      id: z.string(),
      application_id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.number().int(),
      options: z.array(z.unknown()).optional(),
      default_member_permissions: z.string().nullable().optional(),
      permissions: IndexPermissions.optional(),
    }),
  ),
});

/** Read metadata only; never invoke an interaction or hide a failed lookup. */
export async function userApplicationCommands(
  client: UserClient | null,
  channelId: string,
) {
  const channel = await userChannelInfo(client, channelId);
  if (client === null || !channel.canView)
    throw new DaemonError("Assigned channel is not visible");
  const guild = property(client.api, "guilds")(channel.guildId);
  const index = property(guild, "application-command-index");
  const result = ApplicationCommandIndex.parse(await property(index, "get")());
  return { channelId, guildId: channel.guildId, ...result };
}
