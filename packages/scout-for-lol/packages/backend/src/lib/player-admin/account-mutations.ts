import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  type LeaguePuuid,
  LeaguePuuidSchema,
  type PlayerConfigEntry,
  RegionSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { recordAudit } from "#src/lib/audit/index.ts";
import { resolvePuuidFromRiotId } from "#src/discord/commands/admin/utils/riot-api.ts";
import { backfillLastMatchTime } from "#src/league/api/backfill-match-history.ts";
import { getRiotIdByPuuid } from "#src/lib/riot/account-riot-id.ts";
import {
  AliasSchema,
  assertAdmin,
  conflict,
  GuildIdInput,
  getPlayerOrThrow,
  isUniqueConstraintError,
  notFound,
  RiotAccountInput,
  type WebCtx,
} from "#src/lib/player-admin/shared.ts";

export const AddAccountInput = RiotAccountInput.extend({
  playerAlias: AliasSchema,
});
export const TransferAccountInput = RiotAccountInput.extend({
  toPlayerAlias: AliasSchema,
});
export const UpdateAccountInput = GuildIdInput.extend({
  accountId: z.number().int().min(1),
  alias: AliasSchema.optional(),
  region: RegionSchema.optional(),
});
export type AddAccountInputData = z.infer<typeof AddAccountInput>;
export type RiotAccountInputData = z.infer<typeof RiotAccountInput>;
export type TransferAccountInputData = z.infer<typeof TransferAccountInput>;
export type UpdateAccountInputData = z.infer<typeof UpdateAccountInput>;

async function resolvePuuidOrThrow(
  input: RiotAccountInputData,
): Promise<LeaguePuuid> {
  const result = await resolvePuuidFromRiotId(input.riotId, input.region);
  if (!result.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Riot ID lookup failed: ${result.error}`,
    });
  }
  return LeaguePuuidSchema.parse(result.puuid);
}

export async function addAccount(ctx: WebCtx, input: AddAccountInputData) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: input.playerAlias,
  });
  const puuid = await resolvePuuidOrThrow(input);

  const now = new Date();
  const accountAlias = `${input.riotId.game_name}#${input.riotId.tag_line}`;
  const created = await prisma
    .$transaction(async (tx) => {
      const existing = await tx.account.findUnique({
        where: { serverId_puuid: { serverId: input.guildId, puuid } },
        include: { player: true },
      });
      if (existing !== null) {
        throw conflict(
          `Account is already attached to "${existing.player.alias}"`,
        );
      }

      const account = await tx.account.create({
        data: {
          alias: accountAlias,
          puuid,
          region: input.region,
          // Seed the cached Riot ID from the user-supplied input so the UI
          // shows it immediately; the 24h refresh canonicalizes it later.
          riotGameName: input.riotId.game_name,
          riotTagLine: input.riotId.tag_line,
          riotIdUpdatedAt: now,
          playerId: player.id,
          serverId: input.guildId,
          creatorDiscordId: ctx.user.discordId,
          createdTime: now,
          updatedTime: now,
        },
      });
      await recordAudit(
        {
          action: "ACCOUNT_ADD",
          actorDiscordId: ctx.user.discordId,
          serverId: input.guildId,
          targetPlayerId: player.id,
          targetAccountId: account.id,
          payload: {
            playerAlias: player.alias,
            accountAlias,
            region: input.region,
          },
          ipAddress: ctx.webSession.ipAddress,
          userAgent: ctx.webSession.userAgent,
        },
        tx,
      );
      return account;
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        throw conflict("Account is already attached to another player");
      }
      throw error;
    });

  const playerConfigEntry: PlayerConfigEntry = {
    alias: player.alias,
    league: { leagueAccount: { puuid, region: input.region } },
    ...(player.discordId === null
      ? {}
      : {
          discordAccount: {
            id: DiscordAccountIdSchema.parse(player.discordId),
          },
        }),
  };
  void backfillLastMatchTime(playerConfigEntry, puuid);
  return { accountId: created.id, accountAlias: created.alias };
}

export async function deleteAccount(ctx: WebCtx, input: RiotAccountInputData) {
  await assertAdmin(ctx, input.guildId);
  const puuid = await resolvePuuidOrThrow(input);

  const deleted = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { serverId_puuid: { serverId: input.guildId, puuid } },
      include: { player: true },
    });
    if (account === null) throw notFound("Account was not found");

    const sourceAccountCount = await tx.account.count({
      where: { playerId: account.player.id },
    });
    if (sourceAccountCount === 1) {
      throw conflict("Cannot remove the last account from a player");
    }

    await tx.account.delete({ where: { id: account.id } });
    await tx.player.update({
      where: { id: account.player.id },
      data: { updatedTime: new Date() },
    });
    await recordAudit(
      {
        action: "ACCOUNT_DELETE",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: account.player.id,
        targetAccountId: account.id,
        payload: {
          playerAlias: account.player.alias,
          accountAlias: account.alias,
          region: account.region,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return { accountId: account.id, playerAlias: account.player.alias };
  });
  return {
    deletedAccountId: deleted.accountId,
    playerAlias: deleted.playerAlias,
  };
}

export async function transferAccount(
  ctx: WebCtx,
  input: TransferAccountInputData,
) {
  await assertAdmin(ctx, input.guildId);
  const puuid = await resolvePuuidOrThrow(input);

  const now = new Date();
  const transferred = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { serverId_puuid: { serverId: input.guildId, puuid } },
      include: { player: true },
    });
    if (account === null) throw notFound("Account was not found");

    const targetPlayer = await tx.player.findUnique({
      where: {
        serverId_alias: {
          serverId: input.guildId,
          alias: input.toPlayerAlias,
        },
      },
    });
    if (targetPlayer === null) {
      throw notFound(`Player "${input.toPlayerAlias}" was not found`);
    }
    if (account.player.id === targetPlayer.id) {
      throw conflict("Account is already attached to that player");
    }

    const sourceAccountCount = await tx.account.count({
      where: { playerId: account.player.id },
    });
    if (sourceAccountCount === 1) {
      throw conflict("Cannot transfer the last account from a player");
    }

    await tx.account.update({
      where: { id: account.id },
      data: { playerId: targetPlayer.id, updatedTime: now },
    });
    await tx.player.updateMany({
      where: { id: { in: [account.player.id, targetPlayer.id] } },
      data: { updatedTime: now },
    });
    await recordAudit(
      {
        action: "ACCOUNT_TRANSFER",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: targetPlayer.id,
        targetAccountId: account.id,
        payload: {
          accountAlias: account.alias,
          fromPlayerAlias: account.player.alias,
          toPlayerAlias: targetPlayer.alias,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return {
      accountId: account.id,
      fromPlayerAlias: account.player.alias,
      toPlayerAlias: targetPlayer.alias,
    };
  });
  return transferred;
}

/**
 * Edit an existing account's alias and/or region in place. Identified by
 * accountId (no Riot lookup needed for an alias-only edit). If the region
 * changes, the cached Riot ID is re-resolved so the displayed gameName#tag
 * reflects the new routing.
 */
export async function updateAccount(
  ctx: WebCtx,
  input: UpdateAccountInputData,
) {
  await assertAdmin(ctx, input.guildId);
  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    include: { player: true },
  });
  if (account === null) {
    throw notFound("Account was not found");
  }
  if (account.serverId !== input.guildId) {
    throw notFound("Account was not found");
  }

  const nextAlias = input.alias ?? account.alias;
  const nextRegion = input.region ?? account.region;
  const regionChanged =
    input.region !== undefined && input.region !== account.region;

  // Re-resolve the Riot ID when routing changes (best-effort; an API
  // failure leaves the cached value untouched rather than blocking the edit).
  const riotRefresh =
    regionChanged && input.region !== undefined
      ? await getRiotIdByPuuid(account.puuid, input.region)
      : null;

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.account.update({
      where: { id: account.id },
      data: {
        alias: nextAlias,
        region: nextRegion,
        ...(riotRefresh === null
          ? {}
          : {
              riotGameName: riotRefresh.gameName,
              riotTagLine: riotRefresh.tagLine,
              riotIdUpdatedAt: now,
            }),
        updatedTime: now,
      },
    });
    await tx.player.update({
      where: { id: account.playerId },
      data: { updatedTime: now },
    });
    await recordAudit(
      {
        action: "ACCOUNT_UPDATE",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: account.playerId,
        targetAccountId: account.id,
        payload: {
          playerAlias: account.player.alias,
          previousAlias: account.alias,
          alias: nextAlias,
          previousRegion: account.region,
          region: nextRegion,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return result;
  });

  return {
    accountId: updated.id,
    alias: updated.alias,
    region: updated.region,
  };
}
