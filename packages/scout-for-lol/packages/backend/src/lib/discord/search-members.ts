/**
 * Guild-member typeahead for the web UI's add/invite flows.
 *
 * This used to call discord.js `guild.members.fetch({ query, limit })`, which
 * issues an OP 8 REQUEST_GUILD_MEMBERS over the gateway — it cannot answer at
 * all without a live shard, and it first has to find the guild in the gateway
 * cache. The equivalent REST endpoint is `GET /guilds/{id}/members/search`,
 * which takes the same prefix query over usernames and nicknames and works from
 * a pod that never connected a gateway.
 *
 * Note which endpoint that is: **Search** Guild Members, not **List** Guild
 * Members. Listing the roster (`GET /guilds/{id}/members`) is the one that
 * requires the privileged GUILD_MEMBERS intent; the search endpoint documents
 * no intent requirement, which is the same asymmetry the gateway had — the
 * query-limited member fetch this replaced also worked without the intent,
 * while an unfiltered chunk request did not.
 *
 * Authorization is handled by the router before this function is called.
 *
 * ## Failures are not empty results
 *
 * This deliberately does NOT swallow errors. An empty array means Discord
 * answered and nobody matched; anything else propagates as
 * {@link DiscordUpstreamError} so the router reports SERVICE_UNAVAILABLE and
 * increments the bot-REST failure counter. Returning `[]` on failure — as this
 * did originally — makes a 403 from a misconfigured install, a 5xx, or a
 * network fault indistinguishable from "no such member": four typeaheads would
 * silently blank, the user would conclude the person is not in their server,
 * and nothing would be counted or alerted on. A typeahead that reports it could
 * not reach Discord is strictly better than one that quietly lies.
 */

import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  botRest,
  memberAvatarUrl,
  memberDisplayName,
  type BotRestReader,
} from "#src/lib/discord/bot-rest.ts";

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

/**
 * Members of `guildId` whose username or nickname starts with `query`.
 *
 * `[]` means Discord answered with no matches (including the case where Scout
 * is not in the guild, which the port reports as absence). Throws
 * {@link DiscordUpstreamError} when Discord could not be asked.
 */
export async function searchGuildMembers(
  input: SearchMembersInput,
  dependencies: SearchMembersDependencies = defaultDependencies(),
): Promise<SearchedMember[]> {
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
}
