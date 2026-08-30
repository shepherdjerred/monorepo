import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { lockCustomGuild } from "#src/customs/repository.ts";

const PENDING_VOICE_STATES = [
  "PROVISIONING",
  "RETURNING",
  "CLEANING_UP",
] as const;
const AuditPayloadSchema = z.json();

function replaceAuditIdentity(
  value: z.infer<typeof AuditPayloadSchema>,
  original: DiscordAccountId,
  pseudonym: DiscordAccountId,
): z.infer<typeof AuditPayloadSchema> {
  if (typeof value === "string") return value === original ? pseudonym : value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceAuditIdentity(item, original, pseudonym));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceAuditIdentity(item, original, pseudonym),
      ]),
    );
  }
  return value;
}

function anonymizedDiscordId(
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): DiscordAccountId {
  const digest = anonymizedDigest("discord", guildId, discordId);
  const numericId =
    (BigInt(`0x${digest.slice(0, 16)}`) % 900_000_000_000_000_000n) +
    100_000_000_000_000_000n;
  return DiscordAccountIdSchema.parse(numericId.toString());
}

function anonymizedDigest(
  scope: string,
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): string {
  const secret = configuration.jwtSigningSecret;
  if (secret === undefined) {
    throw new Error("JWT_SIGNING_SECRET is required for Customs anonymization");
  }
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(`${scope}:${guildId}:${discordId}`);
  return hasher.digest("hex");
}

function anonymizedNumericId(
  scope: "player" | "account",
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): number {
  const digest = anonymizedDigest(scope, guildId, discordId);
  return (
    1_000_000_000 + (Number.parseInt(digest.slice(0, 8), 16) % 1_147_483_647)
  );
}

function anonymizedPuuid(
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): string {
  return `anonymized-id-${anonymizedDigest("puuid", guildId, discordId)}`;
}

export async function anonymizeCustomParticipant(
  client: ExtendedPrismaClient,
  input: {
    readonly guildId: DiscordGuildId;
    readonly discordId: DiscordAccountId;
    readonly operatorId: string;
    readonly now?: Date;
  },
): Promise<{ pseudonym: string; nightCount: number }> {
  const pseudonym = anonymizedDiscordId(input.guildId, input.discordId);
  const pseudonymousPlayerId = anonymizedNumericId(
    "player",
    input.guildId,
    input.discordId,
  );
  const pseudonymousAccountId = anonymizedNumericId(
    "account",
    input.guildId,
    input.discordId,
  );
  const pseudonymousPuuid = anonymizedPuuid(input.guildId, input.discordId);
  const now = input.now ?? new Date();
  const operatorActorId = `operator:${
    input.operatorId === input.discordId ? pseudonym : input.operatorId
  }`;
  const nightCount = await client.$transaction(async (transaction) => {
    await lockCustomGuild(transaction, input.guildId);
    const pendingVoice = await transaction.customGame.findFirst({
      where: {
        night: { guildId: input.guildId },
        participants: { some: { discordId: input.discordId } },
        OR: [
          { voiceState: { in: [...PENDING_VOICE_STATES] } },
          { night: { teamAVoiceChannelId: { not: null } } },
          { night: { teamBVoiceChannelId: { not: null } } },
        ],
      },
    });
    if (pendingVoice !== null) {
      throw new Error("Cannot anonymize while Customs voice work is pending");
    }
    const guildNights = await transaction.customNight.findMany({
      where: { guildId: input.guildId },
      select: {
        id: true,
        revision: true,
        hostDiscordId: true,
        participants: {
          where: { discordId: input.discordId },
          select: { id: true },
        },
        cohosts: {
          where: { discordId: input.discordId },
          select: { discordId: true },
        },
        auditEvents: { select: { id: true, actorId: true, payload: true } },
      },
    });
    const prefixedActorId = `operator:${input.discordId}`;
    const nights = guildNights.filter(
      (night) =>
        night.hostDiscordId === input.discordId ||
        night.participants.length > 0 ||
        night.cohosts.length > 0 ||
        night.auditEvents.some((event) => {
          if (
            event.actorId === input.discordId ||
            event.actorId === prefixedActorId
          ) {
            return true;
          }
          const payload = AuditPayloadSchema.parse(JSON.parse(event.payload));
          return (
            JSON.stringify(
              replaceAuditIdentity(payload, input.discordId, pseudonym),
            ) !== event.payload
          );
        }),
    );
    const nightIds = nights.map((night) => night.id);
    const affectedActiveNight = await transaction.customActiveNight.findFirst({
      where: { nightId: { in: nightIds } },
    });
    if (affectedActiveNight !== null) {
      throw new Error(
        "Cannot anonymize a participant in an active custom night",
      );
    }
    const auditEvents = nights.flatMap((night) => night.auditEvents);
    const consents = await transaction.customConsent.findMany({
      where: { guildId: input.guildId, discordId: input.discordId },
      select: {
        id: true,
        disclosureVersion: true,
        acceptedAt: true,
      },
    });
    for (const consent of consents) {
      const pseudonymousConsent = await transaction.customConsent.findUnique({
        where: {
          guildId_discordId_disclosureVersion: {
            guildId: input.guildId,
            discordId: pseudonym,
            disclosureVersion: consent.disclosureVersion,
          },
        },
        select: { id: true, acceptedAt: true },
      });
      if (pseudonymousConsent === null) {
        await transaction.customConsent.update({
          where: { id: consent.id },
          data: { discordId: pseudonym, anonymizedAt: now },
        });
        continue;
      }
      await transaction.customConsent.update({
        where: { id: pseudonymousConsent.id },
        data: {
          acceptedAt: new Date(
            Math.min(
              pseudonymousConsent.acceptedAt.getTime(),
              consent.acceptedAt.getTime(),
            ),
          ),
          anonymizedAt: now,
        },
      });
      await transaction.customConsent.delete({ where: { id: consent.id } });
    }
    await transaction.customNightParticipant.updateMany({
      where: {
        discordId: input.discordId,
        nightId: { in: nightIds },
      },
      data: {
        discordId: pseudonym,
        displayName: "Anonymized player",
        avatarUrl: null,
        playerId: null,
        playerAlias: null,
        selectedAccountId: null,
      },
    });
    await transaction.customGameParticipant.updateMany({
      where: {
        discordId: input.discordId,
        game: { nightId: { in: nightIds } },
      },
      data: {
        discordId: pseudonym,
        displayName: "Anonymized player",
        playerId: PlayerIdSchema.parse(pseudonymousPlayerId),
        playerAlias: "Anonymized player",
        accountId: AccountIdSchema.parse(pseudonymousAccountId),
        puuid: LeaguePuuidSchema.parse(pseudonymousPuuid),
        riotGameName: null,
        riotTagLine: null,
      },
    });
    await transaction.customNightCohost.updateMany({
      where: {
        discordId: input.discordId,
        nightId: { in: nightIds },
      },
      data: { discordId: pseudonym },
    });
    await transaction.customNight.updateMany({
      where: { id: { in: nightIds }, hostDiscordId: input.discordId },
      data: { hostDiscordId: pseudonym },
    });
    await transaction.customAuditEvent.updateMany({
      where: {
        actorId: input.discordId,
        night: { guildId: input.guildId },
      },
      data: { actorId: pseudonym },
    });
    await transaction.customAuditEvent.updateMany({
      where: {
        actorId: prefixedActorId,
        nightId: { in: nightIds },
      },
      data: { actorId: `operator:${pseudonym}` },
    });
    for (const event of auditEvents) {
      const payload = AuditPayloadSchema.parse(JSON.parse(event.payload));
      const redacted = JSON.stringify(
        replaceAuditIdentity(payload, input.discordId, pseudonym),
      );
      if (redacted !== event.payload) {
        await transaction.customAuditEvent.update({
          where: { id: event.id },
          data: { payload: redacted },
        });
      }
    }
    for (const night of nights) {
      const revision = night.revision + 1;
      await transaction.customNight.update({
        where: { id: night.id },
        data: { revision },
      });
      await transaction.customAuditEvent.create({
        data: {
          nightId: night.id,
          revision,
          actorId: operatorActorId,
          action: "PARTICIPANT_ANONYMIZED",
          payload: JSON.stringify({ pseudonym }),
          source: "OPERATOR",
        },
      });
    }
    return nights.length;
  });
  return { pseudonym, nightCount };
}

export async function anonymizeCustomParticipantFromStrings(input: {
  readonly guildId: string;
  readonly discordId: string;
  readonly operatorId: string;
}) {
  return anonymizeCustomParticipant(prisma, {
    guildId: DiscordGuildIdSchema.parse(input.guildId),
    discordId: DiscordAccountIdSchema.parse(input.discordId),
    operatorId: input.operatorId,
  });
}
