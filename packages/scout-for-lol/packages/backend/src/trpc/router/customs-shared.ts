import type {
  CustomActivityClaims,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { customActorForSession } from "#src/customs/discord-client.ts";
import { getCustomNight } from "#src/customs/repository.ts";
import { syncCustomRecruitmentMessage } from "#src/customs/recruitment-message.ts";
import { publishCustomSnapshot } from "#src/customs/socket.ts";
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
  if (result.applied !== false) publishCustomSnapshot(result.snapshot);
  if (result.applied === false) return result;
  try {
    const snapshot = await syncCustomRecruitmentMessage({
      prisma,
      snapshot: result.snapshot,
    });
    if (snapshot.revision > result.snapshot.revision)
      publishCustomSnapshot(snapshot);
    return { ...result, snapshot };
  } catch (error) {
    logger.error(
      "Custom night state committed but recruitment message sync failed",
      { error },
    );
    await prisma.customAuditEvent.create({
      data: {
        nightId: result.snapshot.id,
        revision: result.snapshot.revision,
        actorId: "SCOUT",
        action: "RECRUITMENT_MESSAGE_SYNC_PENDING",
        payload: JSON.stringify({}),
        source: "DISCORD",
      },
    });
    return result;
  }
}
