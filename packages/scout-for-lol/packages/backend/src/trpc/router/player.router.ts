import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import {
  GuildIdInput,
  PlayerLookupInput,
  RiotAccountInput,
} from "#src/lib/player-admin/shared.ts";
import {
  ListPlayersInput,
  getCurrentLinkedPlayer,
  getPlayer,
  listPlayers,
} from "#src/lib/player-admin/queries.ts";
import {
  AddAccountInput,
  TransferAccountInput,
  addAccount,
  deleteAccount,
  transferAccount,
} from "#src/lib/player-admin/account-mutations.ts";
import {
  LinkDiscordInput,
  MergePlayersInput,
  RenamePlayerInput,
  UnlinkDiscordInput,
  deletePlayer,
  linkDiscord,
  mergePlayers,
  renamePlayer,
  unlinkDiscord,
} from "#src/lib/player-admin/player-mutations.ts";

export const playerRouter = router({
  listPlayers: webProcedure
    .input(ListPlayersInput)
    .query(async ({ ctx, input }) => listPlayers(ctx, input)),

  getPlayer: webProcedure
    .input(PlayerLookupInput)
    .query(async ({ ctx, input }) => getPlayer(ctx, input)),

  getCurrentLinkedPlayer: webProcedure
    .input(GuildIdInput)
    .query(async ({ ctx, input }) => getCurrentLinkedPlayer(ctx, input)),

  renamePlayer: webMutationProcedure
    .input(RenamePlayerInput)
    .mutation(async ({ ctx, input }) => renamePlayer(ctx, input)),

  deletePlayer: webMutationProcedure
    .input(PlayerLookupInput)
    .mutation(async ({ ctx, input }) => deletePlayer(ctx, input)),

  mergePlayers: webMutationProcedure
    .input(MergePlayersInput)
    .mutation(async ({ ctx, input }) => mergePlayers(ctx, input)),

  linkDiscord: webMutationProcedure
    .input(LinkDiscordInput)
    .mutation(async ({ ctx, input }) => linkDiscord(ctx, input)),

  unlinkDiscord: webMutationProcedure
    .input(UnlinkDiscordInput)
    .mutation(async ({ ctx, input }) => unlinkDiscord(ctx, input)),

  addAccount: webMutationProcedure
    .input(AddAccountInput)
    .mutation(async ({ ctx, input }) => addAccount(ctx, input)),

  deleteAccount: webMutationProcedure
    .input(RiotAccountInput)
    .mutation(async ({ ctx, input }) => deleteAccount(ctx, input)),

  transferAccount: webMutationProcedure
    .input(TransferAccountInput)
    .mutation(async ({ ctx, input }) => transferAccount(ctx, input)),
});
