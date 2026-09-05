import { prisma, type Db } from "#src/database/index.ts";

const CHALLENGE_PROGRESSION_LOCK_NAMESPACE = "scout-challenge-progression";
const CHALLENGE_PROGRESSION_GLOBAL_LOCK_KEY = "all-runs";

export async function lockChallengeProgression(
  tx: Pick<Db, "$executeRaw">,
  puuids: readonly string[],
): Promise<void> {
  // A match can involve a disjoint participant set from another simultaneous
  // match while both still affect the same challenge run. Take one shared
  // lock before the participant locks so timeline staging, revision creation,
  // and cursor advancement are serialized for every run.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${CHALLENGE_PROGRESSION_LOCK_NAMESPACE}),
      hashtext(${CHALLENGE_PROGRESSION_GLOBAL_LOCK_KEY})
    )
  `;
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
