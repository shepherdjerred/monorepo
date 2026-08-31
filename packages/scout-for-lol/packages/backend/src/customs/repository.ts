import { z } from "zod";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import {
  CustomNightStateSchema,
  type AccountId,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type PlayerId,
} from "@scout-for-lol/data";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });
const AuditSourceSchema = z.enum([
  "ACTIVITY",
  "DISCORD",
  "RIOT",
  "OPERATOR",
  "TEMPORAL",
]);
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
  readonly hostPlayerId?: PlayerId | null;
  readonly hostPlayerAlias?: string | null;
  readonly hostSelectedAccountId?: AccountId | null;
  readonly disclosureVersion: string;
  readonly now: Date;
};

export async function lockCustomGuild(
  transaction: Db,
  guildId: DiscordGuildId,
): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-customs'), hashtext(${guildId}))`;
}

export async function createCustomNight(
  client: ExtendedPrismaClient,
  input: CreateCustomNightInput,
): Promise<{ id: string; revision: number }> {
  try {
    return await client.$transaction(async (transaction) => {
      await lockCustomGuild(transaction, input.guildId);
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
          playerId: input.hostPlayerId ?? null,
          playerAlias: input.hostPlayerAlias ?? null,
          selectedAccountId: input.hostSelectedAccountId ?? null,
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
  readonly actorId: string;
  readonly action: string;
  readonly payload: unknown;
  readonly source: z.infer<typeof AuditSourceSchema>;
  readonly state?: z.infer<typeof CustomNightStateSchema>;
  readonly now: Date;
};

async function claimCustomNightRevision(
  transaction: Db,
  input: Pick<CustomNightMutation, "nightId" | "expectedRevision" | "now">,
  state?: z.infer<typeof CustomNightStateSchema>,
): Promise<number> {
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
  return input.expectedRevision + 1;
}

async function appendCustomAuditEvent(
  transaction: Db,
  input: Pick<
    CustomNightMutation,
    "nightId" | "actorId" | "action" | "payload" | "source"
  > & { readonly gameId?: string },
  revision: number,
): Promise<void> {
  const source = AuditSourceSchema.parse(input.source);
  const payload = JsonPayloadSchema.parse(input.payload);
  await transaction.customAuditEvent.create({
    data: {
      nightId: input.nightId,
      ...(input.gameId === undefined ? {} : { gameId: input.gameId }),
      revision,
      actorId: input.actorId,
      action: input.action,
      payload: JSON.stringify(payload),
      source,
    },
  });
}

/**
 * Advances a night revision and writes its audit event in one transaction.
 * Feature services perform their normalized row mutations in the same pattern;
 * this helper owns lifecycle-only transitions and the active pointer.
 */
export async function mutateCustomNight(
  client: ExtendedPrismaClient,
  input: CustomNightMutation,
): Promise<number> {
  const state =
    input.state === undefined
      ? undefined
      : CustomNightStateSchema.parse(input.state);
  return client.$transaction(async (transaction) => {
    const revision = await claimCustomNightRevision(transaction, input, state);
    await appendCustomAuditEvent(transaction, input, revision);
    if (state === "ENDED") {
      await transaction.customActiveNight.delete({
        where: { nightId: input.nightId },
      });
    }
    return revision;
  });
}

export type CommitCustomMutationInput = Omit<CustomNightMutation, "state"> & {
  readonly gameId?: string;
};

/**
 * Claims one optimistic-concurrency revision, applies normalized row changes,
 * and appends the matching audit event in the same PostgreSQL transaction.
 */
export async function commitCustomMutation(
  client: ExtendedPrismaClient,
  input: CommitCustomMutationInput,
  mutate: (transaction: Db, revision: number) => Promise<void>,
): Promise<number> {
  return client.$transaction(async (transaction) => {
    const revision = await claimCustomNightRevision(transaction, input);
    await mutate(transaction, revision);
    await appendCustomAuditEvent(transaction, input, revision);
    return revision;
  });
}
