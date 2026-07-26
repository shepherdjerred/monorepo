/**
 * Discord helper procedures for the web UI: resolving raw snowflakes to
 * display names, and a guild-member typeahead for the add/invite flows.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { type Permission, P } from "@scout-for-lol/data";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import { resolveGuildPermissions } from "#src/trpc/guild-permission.ts";
import {
  MAX_IDS_PER_RESOLVE,
  resolveDiscordUsers,
} from "#src/lib/discord/resolve-users.ts";
import {
  SearchMembersInputSchema,
  searchGuildMembers,
} from "#src/lib/discord/search-members.ts";

const MEMBER_SEARCH_PERMISSIONS: Permission[] = [
  P("players", "read"),
  P("players", "link"),
  P("roles", "grant"),
  P("competitions", "invite"),
  P("subscriptions", "create"),
];

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
   * Typeahead search for members of a guild. The roster is available to callers
   * holding any action whose UI needs a member selector; the Discord lookup
   * still returns [] on failure so an authorized form degrades gracefully.
   */
  searchMembers: webProcedure
    .input(SearchMembersInputSchema)
    .query(async ({ ctx, input }) => {
      const permissions = await resolveGuildPermissions(
        ctx.user,
        input.guildId,
      );
      if (!permissions.canAny(...MEMBER_SEARCH_PERMISSIONS)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Missing a permission that authorizes Discord member selection",
        });
      }
      return searchGuildMembers(input);
    }),
});
