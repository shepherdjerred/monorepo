import type {
  CustomActivityClaims,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { customActorForSession } from "#src/customs/discord-client.ts";
import { getCustomNight } from "#src/customs/repository.ts";
import {
  recordPendingCustomRecruitmentSync,
  syncCustomRecruitmentMessage,
} from "#src/customs/recruitment-message.ts";
import { publishCustomSnapshotIfCurrent } from "#src/customs/socket.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-router");

export function assertClaimsGuild(
  claimsGuildId: string,
  inputGuildId: string,
): void {
  if (claimsGuildId !== inputGuildId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Activity guild mismatch",
    });
  }
}

export async function customActorForNight(
  claims: CustomActivityClaims,
  nightId: string,
) {
  const snapshot = await getCustomNight(prisma, nightId);
  if (snapshot === null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Custom night not found",
    });
  }
  assertClaimsGuild(claims.guildId, snapshot.guildId);
  return await customActorForSession(claims);
}

export async function broadcast<
  T extends {
    snapshot: CustomNightSnapshot;
    applied?: boolean;
  },
>(result: T): Promise<T> {
  if (result.applied !== false)
    publishCustomSnapshotIfCurrent(prisma, result.snapshot);
  if (result.applied === false) return result;
  try {
    const snapshot = await syncCustomRecruitmentMessage({
      prisma,
      snapshot: result.snapshot,
    });
    if (snapshot.revision > result.snapshot.revision)
      publishCustomSnapshotIfCurrent(prisma, snapshot);
    return { ...result, snapshot };
  } catch (error) {
    logger.error(
      "Custom night state committed but recruitment message sync failed",
      { error },
    );
    await recordPendingCustomRecruitmentSync({
      prisma,
      snapshot: result.snapshot,
    });
    return result;
  }
}
