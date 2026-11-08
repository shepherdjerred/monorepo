import { createHash } from "node:crypto";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";

export function riotLinkDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function notificationOptOuts(
  puuids: readonly LeaguePuuid[],
  db: Db = prisma,
): Promise<Set<string>> {
  const rows = await db.riotAccountPreference.findMany({
    where: { puuid: { in: [...puuids] }, matchNotificationsEnabled: false },
    select: { puuid: true },
  });
  return new Set(rows.map((row) => row.puuid));
}

export async function createRiotLinkAttempt(
  input: { state: string; discordId: DiscordAccountId; sessionId: string },
  db: ExtendedPrismaClient = prisma,
  now = new Date(),
): Promise<"created" | "rate-limited"> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`riot-link:${input.discordId}`}, 0))`;
    await tx.riotOAuthLinkAttempt.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    if (
      (await tx.riotOAuthLinkAttempt.count({
        where: { discordId: input.discordId },
      })) >= 5
    ) {
      return "rate-limited";
    }
    await tx.riotOAuthLinkAttempt.create({
      data: {
        stateDigest: riotLinkDigest(input.state),
        discordId: input.discordId,
        sessionDigest: riotLinkDigest(input.sessionId),
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      },
    });
    return "created";
  });
}

export async function completeRiotLink(
  input: { state: string; discordId: DiscordAccountId; sessionId: string },
  db: ExtendedPrismaClient = prisma,
  now = new Date(),
): Promise<"linked" | "account-conflict" | "expired"> {
  return db.$transaction(async (tx) => {
    const where = {
      stateDigest: riotLinkDigest(input.state),
      discordId: input.discordId,
      sessionDigest: riotLinkDigest(input.sessionId),
      expiresAt: { gt: now },
      consumedAt: null,
      verifiedAt: { not: null },
    };
    const consumed = await tx.riotOAuthLinkAttempt.updateMany({
      where,
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return "expired";
    const attempt = await tx.riotOAuthLinkAttempt.findUniqueOrThrow({
      where: { stateDigest: where.stateDigest },
    });
    const { verifiedPuuid, gameName, tagLine, verifiedAt } = attempt;
    if (
      verifiedPuuid === null ||
      gameName === null ||
      tagLine === null ||
      verifiedAt === null
    ) {
      throw new Error("Verified Riot link attempt has no account identity");
    }
    const puuid = LeaguePuuidSchema.parse(verifiedPuuid);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`riot-owner:${puuid}`}, 0))`;
    const existing = await tx.riotAccountPreference.findUnique({
      where: { puuid },
    });
    if (
      existing?.ownerDiscordId !== null &&
      existing?.ownerDiscordId !== undefined &&
      existing.ownerDiscordId !== input.discordId
    ) {
      return "account-conflict";
    }
    await tx.riotAccountPreference.upsert({
      where: { puuid },
      create: {
        puuid,
        ownerDiscordId: input.discordId,
        gameName,
        tagLine,
        verifiedAt,
      },
      update: {
        ownerDiscordId: input.discordId,
        gameName,
        tagLine,
        verifiedAt,
      },
    });
    return "linked";
  });
}
