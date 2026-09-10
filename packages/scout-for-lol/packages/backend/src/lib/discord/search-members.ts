/**
 * Guild-member typeahead for the web UI's add/invite flows.
 *
 * This used to call discord.js `guild.members.fetch({ query, limit })`, which
 * issues an OP 8 REQUEST_GUILD_MEMBERS over the gateway — it cannot answer at
 * all without a live shard, and it first has to find the guild in the gateway
 * cache. The equivalent REST endpoint (`GET /guilds/{id}/members/search`) takes
 * the same prefix query over usernames and nicknames, needs no privileged
 * intent, and works from a pod that never connected a gateway.
 *
 * Authorization is handled by the router before this function is called;
 * fail-soft (returns [] on any error) so a flaky search never breaks the form.
 */

import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  botRest,
  memberAvatarUrl,
  memberDisplayName,
  type BotRestReader,
} from "#src/lib/discord/bot-rest.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-search-members");

export const SearchMembersInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(25).default(10),
});
export type SearchMembersInput = z.infer<typeof SearchMembersInputSchema>;

export type SearchedMember = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
};

export type SearchMembersDependencies = {
  readonly rest: BotRestReader;
};

function defaultDependencies(): SearchMembersDependencies {
  return { rest: botRest() };
}

export async function searchGuildMembers(
  input: SearchMembersInput,
  dependencies: SearchMembersDependencies = defaultDependencies(),
): Promise<SearchedMember[]> {
  try {
    const members = await dependencies.rest.searchGuildMembers({
      guildId: input.guildId,
      query: input.query,
      limit: input.limit,
    });
    return members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      displayName: memberDisplayName(member),
      avatar: memberAvatarUrl(member, input.guildId),
    }));
  } catch (error) {
    logger.warn("Guild member search failed", {
      guildId: input.guildId,
      error,
    });
    return [];
  }
}
