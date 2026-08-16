import {
  CustomNightSnapshotSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CustomAvailability,
  type CustomNightParticipant,
  type CustomNightSnapshot,
  type CustomRole,
} from "@scout-for-lol/data";
import { Prisma } from "#generated/prisma/client/index.js";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { assertCustomHostControl } from "#src/customs/authorization.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";
import {
  commitCustomMutation,
  getActiveCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import {
  CUSTOM_DISCLOSURE_VERSION,
  CUSTOM_NIGHT_TTL_MS,
  hasActiveTournamentCodeProvisioning,
  hasActiveVoiceArrangementProvisioning,
  parseCustomNightSnapshot,
  refreshSnapshot,
} from "#src/customs/snapshot.ts";

export type CustomActor = {
  discordId: string;
  discordAdministrator: boolean;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createCustomNight(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  guildId: string;
  guildName: string;
  launchChannelId: string;
  voiceLobbyChannelId: string;
  now?: Date;
}): Promise<{ created: boolean; snapshot: CustomNightSnapshot }> {
  const active = await getActiveCustomNight(params.prisma, params.guildId);
  if (active !== null) return { created: false, snapshot: active };
  const now = params.now ?? new Date();
  const id = globalThis.crypto.randomUUID();
  const snapshot = CustomNightSnapshotSchema.parse({
    id,
    guildId: params.guildId,
    guildName: params.guildName,
    launchChannelId: params.launchChannelId,
    voiceLobbyChannelId: params.voiceLobbyChannelId,
    hostDiscordId: params.actor.discordId,
    cohostDiscordIds: [],
    state: "RECRUITING",
    revision: 0,
    participants: [],
    currentGame: null,
    recruitmentCounts: { ready: 0, maybe: 0, away: 0, held: 0, remaining: 10 },
    recruitmentMessageId: null,
    riotTournamentId: null,
    teamAVoiceChannelId: null,
    teamBVoiceChannelId: null,
    lastActivityAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CUSTOM_NIGHT_TTL_MS).toISOString(),
    endedAt: null,
  });
  try {
    await params.prisma.$transaction(async (transaction) => {
      await transaction.customNight.create({
        data: {
          id,
          guildId: DiscordGuildIdSchema.parse(params.guildId),
          guildName: params.guildName,
          launchChannelId: DiscordChannelIdSchema.parse(params.launchChannelId),
          voiceLobbyChannelId: DiscordChannelIdSchema.parse(
            params.voiceLobbyChannelId,
          ),
          hostDiscordId: DiscordAccountIdSchema.parse(params.actor.discordId),
          state: snapshot.state,
          snapshot: JSON.stringify(snapshot),
          lastActivityAt: now,
          expiresAt: new Date(snapshot.expiresAt),
        },
      });
      await transaction.customActiveNight.create({
        data: {
          guildId: DiscordGuildIdSchema.parse(params.guildId),
          nightId: id,
        },
      });
      await transaction.customAuditEvent.create({
        data: {
          nightId: id,
          revision: 0,
          actorId: params.actor.discordId,
          action: "NIGHT_CREATED",
          payload: JSON.stringify({
            launchChannelId: params.launchChannelId,
            voiceLobbyChannelId: params.voiceLobbyChannelId,
          }),
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await getActiveCustomNight(
      params.prisma,
      params.guildId,
    );
    if (concurrent === null) throw error;
    return { created: false, snapshot: concurrent };
  }
  return { created: true, snapshot };
}

async function mappedParticipant(params: {
  prisma: ExtendedPrismaClient;
  guildId: string;
  actor: CustomActor;
  displayName: string;
  avatarUrl: string | null;
  host: boolean;
  cohost: boolean;
  now: Date;
}): Promise<CustomNightParticipant> {
  const players = await params.prisma.player.findMany({
    where: {
      serverId: DiscordGuildIdSchema.parse(params.guildId),
      discordId: DiscordAccountIdSchema.parse(params.actor.discordId),
    },
    include: { accounts: { where: { region: "AMERICA_NORTH" } } },
  });
  if (players.length > 1) {
    throw new Error(
      "This Discord account maps to multiple Scout players in the guild",
    );
  }
  const player = players[0];
  const accounts = (player?.accounts ?? []).map((account) => ({
    accountId: account.id,
    puuid: account.puuid,
    region: "AMERICA_NORTH" as const,
    riotGameName: account.riotGameName,
    riotTagLine: account.riotTagLine,
  }));
  return {
    discordId: params.actor.discordId,
    displayName: params.displayName,
    avatarUrl: params.avatarUrl,
    role: params.actor.discordAdministrator
      ? "ADMIN"
      : params.host
        ? "HOST"
        : params.cohost
          ? "COHOST"
          : "MEMBER",
    availability: "MAYBE",
    readyAt: null,
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: params.now.toISOString(),
    playerId: player?.id ?? null,
    playerAlias: player?.alias ?? null,
    accounts,
    selectedAccountId:
      accounts.length === 1 ? (accounts[0]?.accountId ?? null) : null,
  };
}

export async function joinCustomNight(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  displayName: string;
  avatarUrl: string | null;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  const current = await params.prisma.customNight.findUnique({
    where: { id: params.nightId },
  });
  if (current === null) throw new Error("Custom night not found");
  const currentSnapshot = parseCustomNightSnapshot(current.snapshot);
  const participant = await mappedParticipant({
    prisma: params.prisma,
    guildId: current.guildId,
    actor: params.actor,
    displayName: params.displayName,
    avatarUrl: params.avatarUrl,
    host: current.hostDiscordId === params.actor.discordId,
    cohost: currentSnapshot.cohostDiscordIds.includes(params.actor.discordId),
    now,
  });
  return await commitCustomMutation({
    prisma: params.prisma,
    nightId: params.nightId,
    expectedRevision: params.expectedRevision,
    actorDiscordId: params.actor.discordId,
    action: "PARTICIPANT_JOINED",
    payload: { disclosureVersion: CUSTOM_DISCLOSURE_VERSION },
    update: (snapshot) => {
      if (
        snapshot.participants.some(
          (candidate) => candidate.discordId === params.actor.discordId,
        )
      ) {
        throw new Error("You already joined this custom night");
      }
      return refreshSnapshot(
        { ...snapshot, participants: [...snapshot.participants, participant] },
        now,
      );
    },
    sideEffect: async (transaction, snapshot) => {
      await transaction.customConsent.upsert({
        where: {
          guildId_discordId_disclosureVersion: {
            guildId: DiscordGuildIdSchema.parse(snapshot.guildId),
            discordId: DiscordAccountIdSchema.parse(params.actor.discordId),
            disclosureVersion: CUSTOM_DISCLOSURE_VERSION,
          },
        },
        create: {
          guildId: DiscordGuildIdSchema.parse(snapshot.guildId),
          discordId: DiscordAccountIdSchema.parse(params.actor.discordId),
          disclosureVersion: CUSTOM_DISCLOSURE_VERSION,
          acceptedAt: now,
        },
        update: {},
      });
    },
  });
}

export async function setCustomAvailability(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  availability: CustomAvailability;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "AVAILABILITY_SET",
    payload: { availability: params.availability },
    update: (snapshot) => {
      const participants = snapshot.participants.map((participant) =>
        participant.discordId === params.actor.discordId
          ? {
              ...participant,
              availability: params.availability,
              readyAt:
                params.availability === "READY"
                  ? (participant.readyAt ?? now.toISOString())
                  : null,
            }
          : participant,
      );
      if (
        !participants.some(
          (participant) => participant.discordId === params.actor.discordId,
        )
      ) {
        throw new Error("Join the night before setting availability");
      }
      return refreshSnapshot({ ...snapshot, participants }, now);
    },
  });
}

export async function setCustomAway(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  awayUntil: string | null;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action:
      params.awayUntil === null ? "PARTICIPANT_RETURNED" : "PARTICIPANT_AWAY",
    payload: { awayUntil: params.awayUntil },
    update: (snapshot) => {
      if (
        !snapshot.participants.some(
          (participant) => participant.discordId === params.actor.discordId,
        )
      ) {
        throw new Error("Join the night before setting an away time");
      }
      return refreshSnapshot(
        {
          ...snapshot,
          participants: snapshot.participants.map((participant) =>
            participant.discordId === params.actor.discordId
              ? {
                  ...participant,
                  awayUntil: params.awayUntil,
                  awayOverdue: false,
                }
              : participant,
          ),
        },
        now,
      );
    },
  });
}

export async function setCustomHeld(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  discordId: string;
  held: boolean;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: params.held ? "PARTICIPANT_HELD" : "PARTICIPANT_RELEASED",
    payload: { discordId: params.discordId, held: params.held },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      return refreshSnapshot(
        {
          ...snapshot,
          participants: snapshot.participants.map((participant) =>
            participant.discordId === params.discordId
              ? { ...participant, held: params.held }
              : participant,
          ),
        },
        now,
      );
    },
  });
}

export async function setCustomCohost(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  discordId: string;
  cohost: boolean;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: params.cohost ? "COHOST_ADDED" : "COHOST_REMOVED",
    payload: { discordId: params.discordId },
    update: (snapshot) => {
      if (
        snapshot.hostDiscordId !== params.actor.discordId &&
        !params.actor.discordAdministrator
      ) {
        throw new Error(
          "Only the host or a Discord administrator may set cohosts",
        );
      }
      if (
        !snapshot.participants.some(
          (participant) => participant.discordId === params.discordId,
        )
      ) {
        throw new Error("A cohost must have joined the night");
      }
      const cohostDiscordIds = params.cohost
        ? [...new Set([...snapshot.cohostDiscordIds, params.discordId])]
        : snapshot.cohostDiscordIds.filter(
            (discordId) => discordId !== params.discordId,
          );
      const delegatedRole: CustomRole = params.cohost ? "COHOST" : "MEMBER";
      const participants = snapshot.participants.map((participant) =>
        participant.discordId === params.discordId &&
        participant.role !== "HOST" &&
        participant.role !== "ADMIN"
          ? { ...participant, role: delegatedRole }
          : participant,
      );
      return refreshSnapshot(
        { ...snapshot, cohostDiscordIds, participants },
        now,
      );
    },
  });
}

export async function endCustomNight(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "NIGHT_ENDED",
    payload: {},
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      if (hasActiveTournamentCodeProvisioning(snapshot.currentGame, now)) {
        throw new Error(
          "Wait for Tournament code provisioning to finish before ending the night",
        );
      }
      if (hasActiveVoiceArrangementProvisioning(snapshot.currentGame, now)) {
        throw new Error(
          "Wait for voice arrangement to finish before ending the night",
        );
      }
      return CustomNightSnapshotSchema.parse({
        ...snapshot,
        state: transitionCustomNight(snapshot.state, { type: "END_NIGHT" }),
        lastActivityAt: now.toISOString(),
        expiresAt: now.toISOString(),
        endedAt: now.toISOString(),
      });
    },
  });
}
