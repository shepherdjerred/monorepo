/**
 * Discord helper procedures for the web UI: resolving raw snowflakes to
 * display names, and a guild-member typeahead for the add/invite flows.
 */

import { z } from "zod";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import { guildProcedure } from "#src/trpc/guild-permission.ts";
import {
  MAX_IDS_PER_RESOLVE,
  resolveDiscordUsers,
} from "#src/lib/discord/resolve-users.ts";
import {
  SearchMembersInputSchema,
  searchGuildMembers,
} from "#src/lib/discord/search-members.ts";

export const discordRouter = router({
  /**
   * Resolve Discord IDs to `{ username, displayName, avatar }`. Session-only
   * gating is acceptable: Discord usernames/avatars are public and the caller
   * can only resolve IDs it already holds (all of which came from
   * permission-gated reads). No `guildId`, so this stays session-only.
   */
  resolveUsers: webProcedure
    .input(z.object({ ids: z.array(z.string()).max(MAX_IDS_PER_RESOLVE) }))
    .query(async ({ input }) => resolveDiscordUsers(input.ids)),

  /**
   * Typeahead search for members of a guild (add/invite/role flows). Gated on
   * `players:read` (it exposes the guild roster); returns [] on failure so the
   * form degrades gracefully.
   */
  searchMembers: guildProcedure("players", "read")
    .input(SearchMembersInputSchema)
    .query(async ({ input }) => searchGuildMembers(input)),
});
