import type {
  DiscordAccountId,
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { deleteIfExists } from "#src/testing/test-database.ts";

export async function clearCustomsTestData(
  client: ExtendedPrismaClient,
): Promise<void> {
  await deleteIfExists(() => client.customAuditEvent.deleteMany());
  await deleteIfExists(() => client.customGameParticipant.deleteMany());
  await deleteIfExists(() => client.customGame.deleteMany());
  await deleteIfExists(() => client.customNightParticipant.deleteMany());
  await deleteIfExists(() => client.customNightCohost.deleteMany());
  await deleteIfExists(() => client.customActiveNight.deleteMany());
  await deleteIfExists(() => client.customNight.deleteMany());
  await deleteIfExists(() => client.customConsent.deleteMany());
}

export type RetainedCustomNightSeed = {
  readonly guildId: DiscordGuildId;
  readonly guildName: string;
  readonly launchChannelId: DiscordChannelId;
  readonly voiceLobbyChannelId: DiscordChannelId;
  readonly hostDiscordId: DiscordAccountId;
  readonly hostDisplayName: string;
  readonly disclosureVersion: string;
  readonly now: Date;
};

/**
 * Seeds the rows the retired Customs host flow persisted when it opened a
 * night: the night, its active pointer, the host's consent and participant
 * row, and the revision-0 audit event. Live nights can no longer be created,
 * so this exists only to exercise retained-history readers and erasure.
 */
export async function seedRetainedCustomNight(
  client: ExtendedPrismaClient,
  input: RetainedCustomNightSeed,
): Promise<{ id: string }> {
  return client.$transaction(async (transaction) => {
    const night = await transaction.customNight.create({
      data: {
        guildId: input.guildId,
        guildName: input.guildName,
        launchChannelId: input.launchChannelId,
        voiceLobbyChannelId: input.voiceLobbyChannelId,
        hostDiscordId: input.hostDiscordId,
        state: "RECRUITING",
        lastActivityAt: input.now,
        expiresAt: new Date(input.now.getTime() + 12 * 60 * 60 * 1000),
      },
    });
    await transaction.customActiveNight.create({
      data: { guildId: input.guildId, nightId: night.id },
    });
    await transaction.customConsent.upsert({
      where: {
        guildId_discordId_disclosureVersion: {
          guildId: input.guildId,
          discordId: input.hostDiscordId,
          disclosureVersion: input.disclosureVersion,
        },
      },
      create: {
        guildId: input.guildId,
        discordId: input.hostDiscordId,
        disclosureVersion: input.disclosureVersion,
        acceptedAt: input.now,
      },
      update: {},
    });
    await transaction.customNightParticipant.create({
      data: {
        nightId: night.id,
        discordId: input.hostDiscordId,
        displayName: input.hostDisplayName,
        role: "HOST",
        availability: "READY",
        readyAt: input.now,
        consentedAt: input.now,
      },
    });
    await transaction.customAuditEvent.create({
      data: {
        nightId: night.id,
        revision: 0,
        actorId: input.hostDiscordId,
        action: "NIGHT_CREATED",
        payload: JSON.stringify({ disclosureVersion: input.disclosureVersion }),
        source: "ACTIVITY",
      },
    });
    return { id: night.id };
  });
}

/** Appends one retained audit event, optionally ending the night with it. */
export async function appendRetainedCustomAudit(
  client: ExtendedPrismaClient,
  input: {
    readonly nightId: string;
    readonly actorId: string;
    readonly action: string;
    readonly payload: unknown;
    readonly endsNight?: boolean;
    readonly now: Date;
  },
): Promise<void> {
  await client.$transaction(async (transaction) => {
    const night = await transaction.customNight.update({
      where: { id: input.nightId },
      data: {
        revision: { increment: 1 },
        lastActivityAt: input.now,
        ...(input.endsNight === true
          ? { state: "ENDED", endedAt: input.now }
          : {}),
      },
    });
    await transaction.customAuditEvent.create({
      data: {
        nightId: input.nightId,
        revision: night.revision,
        actorId: input.actorId,
        action: input.action,
        payload: JSON.stringify(input.payload),
        source: "ACTIVITY",
      },
    });
    if (input.endsNight === true) {
      await transaction.customActiveNight.delete({
        where: { nightId: input.nightId },
      });
    }
  });
}
