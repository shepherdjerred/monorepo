import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  CustomNightStateSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });
const AuditSourceSchema = z.enum(["ACTIVITY", "DISCORD", "RIOT", "OPERATOR"]);
const JsonPayloadSchema = z.json();

export const CUSTOM_NIGHT_TTL_MS = 12 * 60 * 60 * 1000;

export type CreateCustomNightInput = {
  readonly guildId: DiscordGuildId;
  readonly guildName: string;
  readonly launchChannelId: DiscordChannelId;
  readonly voiceLobbyChannelId: DiscordChannelId;
  readonly hostDiscordId: DiscordAccountId;
  readonly hostDisplayName: string;
  readonly hostAvatarUrl: string | undefined;
  readonly disclosureVersion: string;
  readonly now: Date;
};

export async function createCustomNight(
  client: ExtendedPrismaClient,
  input: CreateCustomNightInput,
): Promise<{ id: string; revision: number }> {
  try {
    return await client.$transaction(async (transaction) => {
      const night = await transaction.customNight.create({
        data: {
          guildId: input.guildId,
          guildName: input.guildName,
          launchChannelId: input.launchChannelId,
          voiceLobbyChannelId: input.voiceLobbyChannelId,
          hostDiscordId: input.hostDiscordId,
          state: "RECRUITING",
          lastActivityAt: input.now,
          expiresAt: new Date(input.now.getTime() + CUSTOM_NIGHT_TTL_MS),
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
          avatarUrl: input.hostAvatarUrl ?? null,
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
          payload: JSON.stringify({
            disclosureVersion: input.disclosureVersion,
          }),
          source: "ACTIVITY",
        },
      });
      return { id: night.id, revision: night.revision };
    });
  } catch (error) {
    if (UniqueViolationSchema.safeParse(error).success) {
      throw new Error(
        `Guild ${input.guildId} already has an active custom night`,
        { cause: error },
      );
    }
    throw error;
  }
}

export type CustomNightMutation = {
  readonly nightId: string;
  readonly expectedRevision: number;
  readonly actorId: DiscordAccountId;
  readonly action: string;
  readonly payload: unknown;
  readonly source: z.infer<typeof AuditSourceSchema>;
  readonly state?: z.infer<typeof CustomNightStateSchema>;
  readonly now: Date;
};

/**
 * Advances a night revision and writes its audit event in one transaction.
 * Feature services perform their normalized row mutations in the same pattern;
 * this helper owns lifecycle-only transitions and the active pointer.
 */
export async function mutateCustomNight(
  client: ExtendedPrismaClient,
  input: CustomNightMutation,
): Promise<number> {
  const source = AuditSourceSchema.parse(input.source);
  const state =
    input.state === undefined
      ? undefined
      : CustomNightStateSchema.parse(input.state);
  const payload = JsonPayloadSchema.parse(input.payload);
  const revision = input.expectedRevision + 1;

  return client.$transaction(async (transaction) => {
    const updated = await transaction.customNight.updateMany({
      where: {
        id: input.nightId,
        revision: input.expectedRevision,
        state: { not: "ENDED" },
      },
      data: {
        revision: { increment: 1 },
        lastActivityAt: input.now,
        ...(state === undefined ? {} : { state }),
        ...(state === "ENDED" ? { endedAt: input.now } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        `Custom night ${input.nightId} revision ${input.expectedRevision.toString()} is stale or ended`,
      );
    }

    await transaction.customAuditEvent.create({
      data: {
        nightId: input.nightId,
        revision,
        actorId: input.actorId,
        action: input.action,
        payload: JSON.stringify(payload),
        source,
      },
    });
    if (state === "ENDED") {
      await transaction.customActiveNight.delete({
        where: { nightId: input.nightId },
      });
    }
    return revision;
  });
}
