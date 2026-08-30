import {
  CUSTOMS_DISCLOSURE_VERSION,
  type AccountId,
  type CustomActivityClaims,
  type CustomAvailability,
  type CustomNightSnapshot,
  type DiscordAccountId,
  type DiscordGuildId,
  type PlayerId,
} from "@scout-for-lol/data";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import {
  assertCustomLaunchChannel,
  customActivityActor,
  customGuildMemberIdentity,
} from "#src/customs/activity-actor.ts";
import {
  customMutationContext as mutationContext,
  customSnapshotForActorAfterMutation as afterMutation,
  requiredCustomSnapshot,
  type CustomRevisionInput as RevisionInput,
} from "#src/customs/activity-mutation-context.ts";
import {
  commitCustomMutation,
  createCustomNight,
  lockCustomGuild,
} from "#src/customs/repository.ts";
type PlayerIdentity = {
  readonly playerId: PlayerId | null;
  readonly playerAlias: string | null;
  readonly selectedAccountId: AccountId | null;
};

async function linkedPlayer(
  client: ExtendedPrismaClient | Db,
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): Promise<PlayerIdentity> {
  const player = await client.player.findFirst({
    where: { serverId: guildId, discordId },
    include: { accounts: { orderBy: { id: "asc" }, take: 1 } },
    orderBy: { id: "asc" },
  });
  if (player === null) {
    return { playerId: null, playerAlias: null, selectedAccountId: null };
  }
  return {
    playerId: player.id,
    playerAlias: player.alias,
    selectedAccountId: player.accounts[0]?.id ?? null,
  };
}

export async function activeCustomNight(
  claims: CustomActivityClaims,
): Promise<CustomNightSnapshot | null> {
  const actor = await customActivityActor(claims);
  const active = await prisma.customActiveNight.findUnique({
    where: { guildId: actor.guildId },
  });
  if (active === null) return null;
  return requiredCustomSnapshot(prisma, active.nightId, actor);
}

export async function startCustomNight(
  claims: CustomActivityClaims,
  _input: Record<string, never>,
): Promise<CustomNightSnapshot> {
  const actor = await customActivityActor(claims);
  await assertCustomLaunchChannel(actor);
  const player = await linkedPlayer(prisma, actor.guildId, actor.discordId);
  const created = await createCustomNight(prisma, {
    guildId: actor.guildId,
    guildName: actor.guildName,
    launchChannelId: actor.channelId,
    voiceLobbyChannelId: actor.channelId,
    hostDiscordId: actor.discordId,
    hostDisplayName: actor.displayName,
    hostAvatarUrl: actor.avatarUrl,
    hostPlayerId: player.playerId,
    hostPlayerAlias: player.playerAlias,
    hostSelectedAccountId: player.selectedAccountId,
    disclosureVersion: CUSTOMS_DISCLOSURE_VERSION,
    now: new Date(),
  });
  return afterMutation(created.id, actor);
}

export async function joinCustomNight(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await mutationContext(claims, input, false);
  if (snapshot.state !== "RECRUITING") {
    throw new Error("Players can join only while a night is recruiting");
  }
  const player = await linkedPlayer(prisma, actor.guildId, actor.discordId);
  const now = new Date();
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "PARTICIPANT_JOINED",
      payload: { disclosureVersion: CUSTOMS_DISCLOSURE_VERSION },
      source: "ACTIVITY",
      now,
    },
    async (transaction) => {
      await lockCustomGuild(transaction, actor.guildId);
      await transaction.customConsent.upsert({
        where: {
          guildId_discordId_disclosureVersion: {
            guildId: actor.guildId,
            discordId: actor.discordId,
            disclosureVersion: CUSTOMS_DISCLOSURE_VERSION,
          },
        },
        create: {
          guildId: actor.guildId,
          discordId: actor.discordId,
          disclosureVersion: CUSTOMS_DISCLOSURE_VERSION,
          acceptedAt: now,
        },
        update: {},
      });
      await transaction.customNightParticipant.create({
        data: {
          nightId: input.nightId,
          discordId: actor.discordId,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl ?? null,
          role: "MEMBER",
          availability: "READY",
          readyAt: now,
          consentedAt: now,
          ...player,
        },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function leaveCustomNight(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await mutationContext(claims, input, false);
  if (snapshot.hostDiscordId === actor.discordId) {
    throw new Error("The host must end the night instead of leaving it");
  }
  if (
    snapshot.currentGame?.participants.some(
      (participant) => participant.discordId === actor.discordId,
    ) === true
  ) {
    throw new Error(
      "A player in the current roster must be substituted before leaving",
    );
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "PARTICIPANT_LEFT",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await transaction.customNightParticipant.delete({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: actor.discordId,
          },
        },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function setCustomAvailability(
  claims: CustomActivityClaims,
  input: RevisionInput & { availability: CustomAvailability },
): Promise<CustomNightSnapshot> {
  const { actor } = await mutationContext(claims, input, false);
  const now = new Date();
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "AVAILABILITY_SET",
      payload: { availability: input.availability },
      source: "ACTIVITY",
      now,
    },
    async (transaction) => {
      await transaction.customNightParticipant.update({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: actor.discordId,
          },
        },
        data: {
          availability: input.availability,
          readyAt: input.availability === "READY" ? now : null,
        },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function setCustomAway(
  claims: CustomActivityClaims,
  input: RevisionInput & { awayUntil: string | null },
): Promise<CustomNightSnapshot> {
  const { actor } = await mutationContext(claims, input, false);
  const awayUntil = input.awayUntil === null ? null : new Date(input.awayUntil);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "AWAY_SET",
      payload: { awayUntil: input.awayUntil },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await transaction.customNightParticipant.update({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: actor.discordId,
          },
        },
        data: { awayUntil },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

async function targetContext(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId },
) {
  const context = await mutationContext(claims, input, true);
  const identity = await customGuildMemberIdentity(
    context.actor,
    input.discordId,
  );
  return { ...context, identity };
}

export async function addCustomParticipant(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot, identity } = await targetContext(claims, input);
  if (snapshot.state !== "RECRUITING") {
    throw new Error("Players can be added only while a night is recruiting");
  }
  const consent = await prisma.customConsent.findFirst({
    where: {
      guildId: actor.guildId,
      discordId: identity.discordId,
      disclosureVersion: CUSTOMS_DISCLOSURE_VERSION,
      anonymizedAt: null,
    },
    orderBy: { acceptedAt: "desc" },
  });
  if (consent === null) {
    throw new Error(
      "This member must consent in the Activity before being added",
    );
  }
  const player = await linkedPlayer(prisma, actor.guildId, identity.discordId);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "PARTICIPANT_ADDED_BY_HOST",
      payload: { discordId: identity.discordId },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await lockCustomGuild(transaction, actor.guildId);
      await transaction.customNightParticipant.create({
        data: {
          nightId: input.nightId,
          discordId: identity.discordId,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl ?? null,
          role: "MEMBER",
          availability: "MAYBE",
          consentedAt: consent.acceptedAt,
          ...player,
        },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function removeCustomParticipant(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await mutationContext(claims, input, true);
  if (snapshot.hostDiscordId === input.discordId) {
    throw new Error("The host cannot be removed from the night");
  }
  if (
    snapshot.currentGame?.participants.some(
      (participant) => participant.discordId === input.discordId,
    ) === true
  ) {
    throw new Error(
      "A player in the current roster must be substituted before removal",
    );
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "PARTICIPANT_REMOVED",
      payload: { discordId: input.discordId },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await transaction.customNightCohost.deleteMany({
        where: { nightId: input.nightId, discordId: input.discordId },
      });
      await transaction.customNightParticipant.delete({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: input.discordId,
          },
        },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function setCustomHeld(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId; held: boolean },
): Promise<CustomNightSnapshot> {
  const { actor } = await mutationContext(claims, input, true);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "HELD_SET",
      payload: { discordId: input.discordId, held: input.held },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await transaction.customNightParticipant.update({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: input.discordId,
          },
        },
        data: { held: input.held },
      });
    },
  );
  return afterMutation(input.nightId, actor);
}

export async function setCustomCohost(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId; cohost: boolean },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await mutationContext(claims, input, true);
  if (snapshot.hostDiscordId === input.discordId) {
    throw new Error("The host already has all cohost permissions");
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "COHOST_SET",
      payload: { discordId: input.discordId, cohost: input.cohost },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      const key = {
        nightId_discordId: {
          nightId: input.nightId,
          discordId: input.discordId,
        },
      };
      if (input.cohost) {
        await transaction.customNightCohost.create({
          data: key.nightId_discordId,
        });
      } else {
        await transaction.customNightCohost.delete({ where: key });
      }
    },
  );
  return afterMutation(input.nightId, actor);
}
