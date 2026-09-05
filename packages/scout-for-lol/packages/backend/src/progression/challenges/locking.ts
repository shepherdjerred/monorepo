import { prisma, type Db } from "#src/database/index.ts";

const CHALLENGE_PROGRESSION_LOCK_NAMESPACE = "scout-challenge-progression";

export async function lockChallengeProgression(
  tx: Pick<Db, "$executeRaw">,
  puuids: readonly string[],
): Promise<void> {
  const uniquePuuids = [...new Set(puuids)].sort();
  for (const puuid of uniquePuuids) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${CHALLENGE_PROGRESSION_LOCK_NAMESPACE}),
        hashtext(${puuid})
      )
    `;
  }
}

export async function withChallengeProgressionLock<T>(
  puuids: readonly string[],
  callback: () => Promise<T>,
): Promise<T> {
  return await prisma.$transaction(
    async (tx) => {
      await lockChallengeProgression(tx, puuids);
      return await callback();
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}
