import type { z } from "zod";
import { DiscordAccountIdSchema, type PlayerId } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { recordAudit, type Db } from "#src/lib/audit/index.ts";
import {
  AliasSchema,
  GuildIdInput,
  assertAdmin,
  conflict,
  getPlayerOrThrow,
  type PlayerLookupInput,
  type WebCtx,
} from "#src/lib/player-admin/shared.ts";

export const RenamePlayerInput = GuildIdInput.extend({
  currentAlias: AliasSchema,
  newAlias: AliasSchema,
});
export const LinkDiscordInput = GuildIdInput.extend({
  playerAlias: AliasSchema,
  discordUserId: DiscordAccountIdSchema,
});
export const UnlinkDiscordInput = GuildIdInput.extend({
  playerAlias: AliasSchema,
});
export const MergePlayersInput = GuildIdInput.extend({
  sourceAlias: AliasSchema,
  targetAlias: AliasSchema,
});

export type RenamePlayerInputData = z.infer<typeof RenamePlayerInput>;
export type LinkDiscordInputData = z.infer<typeof LinkDiscordInput>;
export type UnlinkDiscordInputData = z.infer<typeof UnlinkDiscordInput>;
export type MergePlayersInputData = z.infer<typeof MergePlayersInput>;
export type DeletePlayerInputData = z.infer<typeof PlayerLookupInput>;

export async function renamePlayer(ctx: WebCtx, input: RenamePlayerInputData) {
  await assertAdmin(ctx, input.guildId);
  if (input.currentAlias === input.newAlias) {
    throw conflict("The new alias is the same as the current alias");
  }
  const existing = await prisma.player.findUnique({
    where: {
      serverId_alias: { serverId: input.guildId, alias: input.newAlias },
    },
  });
  if (existing !== null) {
    throw conflict(`A player named "${input.newAlias}" already exists`);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.player.update({
      where: {
        serverId_alias: { serverId: input.guildId, alias: input.currentAlias },
      },
      data: { alias: input.newAlias, updatedTime: now },
    });
    await recordAudit(
      {
        action: "PLAYER_RENAME",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: updated.id,
        payload: {
          previousAlias: input.currentAlias,
          newAlias: input.newAlias,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return { alias: updated.alias };
  });
}

export async function linkDiscord(ctx: WebCtx, input: LinkDiscordInputData) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: input.playerAlias,
  });
  if (player.discordId !== null) {
    throw conflict(`Player "${input.playerAlias}" is already linked`);
  }
  const existingLinkedPlayer = await prisma.player.findFirst({
    where: {
      serverId: input.guildId,
      discordId: input.discordUserId,
      NOT: { id: player.id },
    },
  });
  if (existingLinkedPlayer !== null) {
    throw conflict(
      `Discord user is already linked to "${existingLinkedPlayer.alias}"`,
    );
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.player.update({
      where: { id: player.id },
      data: { discordId: input.discordUserId, updatedTime: now },
    });
    await recordAudit(
      {
        action: "PLAYER_LINK_DISCORD",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: updated.id,
        payload: { alias: updated.alias, discordUserId: input.discordUserId },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return { alias: updated.alias, discordId: updated.discordId };
  });
}

export async function unlinkDiscord(
  ctx: WebCtx,
  input: UnlinkDiscordInputData,
) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: input.playerAlias,
  });
  if (player.discordId === null) {
    throw conflict(`Player "${input.playerAlias}" is not linked`);
  }

  const previousDiscordId = player.discordId;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.player.update({
      where: { id: player.id },
      data: { discordId: null, updatedTime: new Date() },
    });
    await recordAudit(
      {
        action: "PLAYER_UNLINK_DISCORD",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: updated.id,
        payload: { alias: updated.alias, previousDiscordId },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
    return { alias: updated.alias };
  });
}

export async function deletePlayer(ctx: WebCtx, input: DeletePlayerInputData) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow(input);
  await prisma.$transaction(async (tx) => {
    await tx.subscription.deleteMany({ where: { playerId: player.id } });
    await tx.account.deleteMany({ where: { playerId: player.id } });
    await tx.competitionParticipant.deleteMany({
      where: { playerId: player.id },
    });
    await tx.competitionSnapshot.deleteMany({ where: { playerId: player.id } });
    await tx.player.delete({ where: { id: player.id } });
    await recordAudit(
      {
        action: "PLAYER_DELETE",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: player.id,
        payload: {
          alias: player.alias,
          accountCount: player.accounts.length,
          subscriptionCount: player.subscriptions.length,
          competitionParticipantCount: player.competitionParticipants.length,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
  });
  return { deletedAlias: player.alias };
}

export async function mergePlayers(ctx: WebCtx, input: MergePlayersInputData) {
  await assertAdmin(ctx, input.guildId);
  if (input.sourceAlias === input.targetAlias) {
    throw conflict("Cannot merge a player into itself");
  }
  const source = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: input.sourceAlias,
  });
  const target = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: input.targetAlias,
  });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.account.updateMany({
      where: { playerId: source.id },
      data: { playerId: target.id, updatedTime: now },
    });
    const targetChannels = new Set(
      target.subscriptions.map((subscription) => subscription.channelId),
    );
    const sourceOnlyChannels = source.subscriptions
      .map((subscription) => subscription.channelId)
      .filter((channelId) => !targetChannels.has(channelId));
    await tx.subscription.deleteMany({ where: { playerId: source.id } });
    if (sourceOnlyChannels.length > 0) {
      await tx.subscription.createMany({
        data: sourceOnlyChannels.map((channelId) => ({
          playerId: target.id,
          channelId,
          serverId: input.guildId,
          creatorDiscordId: ctx.user.discordId,
          createdTime: now,
          updatedTime: now,
        })),
      });
    }
    await moveCompetitionParticipation(tx, source, target);
    await moveCompetitionSnapshots(tx, source.id, target.id);
    await tx.player.delete({ where: { id: source.id } });
    await tx.player.update({
      where: { id: target.id },
      data: { updatedTime: now },
    });
    await recordAudit(
      {
        action: "PLAYER_MERGE",
        actorDiscordId: ctx.user.discordId,
        serverId: input.guildId,
        targetPlayerId: target.id,
        payload: {
          sourceAlias: source.alias,
          targetAlias: target.alias,
          movedAccountCount: source.accounts.length,
          movedSubscriptionCount: sourceOnlyChannels.length,
        },
        ipAddress: ctx.webSession.ipAddress,
        userAgent: ctx.webSession.userAgent,
      },
      tx,
    );
  });
  return { sourceAlias: source.alias, targetAlias: target.alias };
}

async function moveCompetitionParticipation(
  tx: Db,
  source: Awaited<ReturnType<typeof getPlayerOrThrow>>,
  target: Awaited<ReturnType<typeof getPlayerOrThrow>>,
): Promise<void> {
  const targetCompetitionIds = new Set(
    target.competitionParticipants.map(
      (participant) => participant.competitionId,
    ),
  );
  const sourceOnly = source.competitionParticipants.filter(
    (participant) => !targetCompetitionIds.has(participant.competitionId),
  );
  await tx.competitionParticipant.deleteMany({
    where: { playerId: source.id },
  });
  if (sourceOnly.length === 0) return;
  await tx.competitionParticipant.createMany({
    data: sourceOnly.map((participant) => ({
      competitionId: participant.competitionId,
      playerId: target.id,
      status: participant.status,
      invitedBy: participant.invitedBy,
      invitedAt: participant.invitedAt,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    })),
  });
}

async function moveCompetitionSnapshots(
  tx: Db,
  sourcePlayerId: PlayerId,
  targetPlayerId: PlayerId,
): Promise<void> {
  const sourceSnapshots = await tx.competitionSnapshot.findMany({
    where: { playerId: sourcePlayerId },
    select: { id: true, competitionId: true, snapshotType: true },
  });
  const targetSnapshots = await tx.competitionSnapshot.findMany({
    where: { playerId: targetPlayerId },
    select: { competitionId: true, snapshotType: true },
  });
  const targetKeys = new Set(
    targetSnapshots.map(
      (snapshot) =>
        `${snapshot.competitionId.toString()}-${snapshot.snapshotType}`,
    ),
  );
  const conflictingIds: number[] = [];
  const movableIds: number[] = [];
  for (const snapshot of sourceSnapshots) {
    const key = `${snapshot.competitionId.toString()}-${snapshot.snapshotType}`;
    if (targetKeys.has(key)) conflictingIds.push(snapshot.id);
    else movableIds.push(snapshot.id);
  }
  if (conflictingIds.length > 0) {
    await tx.competitionSnapshot.deleteMany({
      where: { id: { in: conflictingIds } },
    });
  }
  if (movableIds.length > 0) {
    await tx.competitionSnapshot.updateMany({
      where: { id: { in: movableIds } },
      data: { playerId: targetPlayerId },
    });
  }
}
