/**
 * Riot ID lookup/search procedures for the web UI add flows.
 */

import { router, webProcedure } from "#src/trpc/trpc.ts";
import {
  ResolveRiotIdInput,
  SearchKnownAccountsInput,
  resolveRiotIdExact,
  searchKnownAccounts,
} from "#src/lib/player-admin/riot-search.ts";

export const riotRouter = router({
  /** Exact Riot ID → PUUID/canonical name. Read-only; debounce on the client. */
  resolveRiotId: webProcedure
    .input(ResolveRiotIdInput)
    .query(async ({ ctx, input }) => resolveRiotIdExact(ctx, input)),

  /** Fuzzy substring search over this guild's already-known accounts. */
  searchKnownAccounts: webProcedure
    .input(SearchKnownAccountsInput)
    .query(async ({ ctx, input }) => searchKnownAccounts(ctx, input)),
});
