import { router } from "#src/trpc/trpc.ts";
import {
  guildProcedure,
  guildMutationProcedure,
} from "#src/trpc/guild-permission.ts";
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
  UpdateAccountInput,
  addAccount,
  deleteAccount,
  transferAccount,
  updateAccount,
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
  listPlayers: guildProcedure("players", "read")
    .input(ListPlayersInput)
    .query(async ({ ctx, input }) => listPlayers(input, ctx.permissions)),

  getPlayer: guildProcedure("players", "read")
    .input(PlayerLookupInput)
    .query(async ({ ctx, input }) => getPlayer(input, ctx.permissions)),

  getCurrentLinkedPlayer: guildProcedure("players", "read")
    .input(GuildIdInput)
    .query(async ({ ctx, input }) =>
      getCurrentLinkedPlayer(ctx, input, ctx.permissions),
    ),

  renamePlayer: guildMutationProcedure("players", "update")
    .input(RenamePlayerInput)
    .mutation(async ({ ctx, input }) => renamePlayer(ctx, input)),

  deletePlayer: guildMutationProcedure("players", "delete")
    .input(PlayerLookupInput)
    .mutation(async ({ ctx, input }) => deletePlayer(ctx, input)),

  mergePlayers: guildMutationProcedure("players", "merge")
    .input(MergePlayersInput)
    .mutation(async ({ ctx, input }) => mergePlayers(ctx, input)),

  linkDiscord: guildMutationProcedure("players", "link")
    .input(LinkDiscordInput)
    .mutation(async ({ ctx, input }) => linkDiscord(ctx, input)),

  unlinkDiscord: guildMutationProcedure("players", "link")
    .input(UnlinkDiscordInput)
    .mutation(async ({ ctx, input }) => unlinkDiscord(ctx, input)),

  addAccount: guildMutationProcedure("accounts", "create")
    .input(AddAccountInput)
    .mutation(async ({ ctx, input }) => addAccount(ctx, input)),

  deleteAccount: guildMutationProcedure("accounts", "delete")
    .input(RiotAccountInput)
    .mutation(async ({ ctx, input }) => deleteAccount(ctx, input)),

  transferAccount: guildMutationProcedure("accounts", "transfer")
    .input(TransferAccountInput)
    .mutation(async ({ ctx, input }) => transferAccount(ctx, input)),

  updateAccount: guildMutationProcedure("accounts", "update")
    .input(UpdateAccountInput)
    .mutation(async ({ ctx, input }) => updateAccount(ctx, input)),
});
