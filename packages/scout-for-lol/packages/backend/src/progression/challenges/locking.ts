import { z } from "zod";
import { prisma, type Db } from "#src/database/index.ts";

const CHALLENGE_PROGRESSION_LOCK_NAMESPACE = "scout-challenge-progression";
const SelectedAccountPuuidsSchema = z.array(
  z.object({ puuid: z.string().min(1) }),
);

function challengeRunLockKey(runId: string): string {
  return `run:${runId}`;
}

export async function lockChallengeProgression(
  tx: Pick<Db, "$executeRaw" | "challengeRun">,
  puuids: readonly string[],
  explicitRunIds: readonly string[] = [],
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

  // Participant locks coordinate run creation/account edits with post-match
  // processing. They are insufficient for two simultaneous matches whose
  // participant sets are disjoint but whose active challenge run is shared.
  // Discover only runs affected by these participants and serialize those run
  // keys; do not hold a global lock while the callback stages evidence.
  const activeRuns = await tx.challengeRun.findMany({
    where: {
      activePointer: { isNot: null },
      OR: [
        { cursors: { some: { puuid: { in: uniquePuuids } } } },
        { recomputing: true },
      ],
    },
    select: {
      id: true,
      recomputing: true,
      cursors: {
        where: { puuid: { in: uniquePuuids } },
        select: { puuid: true },
      },
      revisions: {
        orderBy: { revision: "desc" },
        take: 1,
        select: { selectedAccountsJson: true },
      },
    },
  });
  const participantSet = new Set(uniquePuuids);
  const affectedRunIds = new Set(explicitRunIds);
  for (const run of activeRuns) {
    if (run.cursors.length > 0) {
      affectedRunIds.add(run.id);
      continue;
    }
    const revision = run.revisions[0];
    if (revision !== undefined && run.recomputing) {
      const selected = SelectedAccountPuuidsSchema.parse(
        JSON.parse(revision.selectedAccountsJson),
      );
      if (selected.some((account) => participantSet.has(account.puuid))) {
        affectedRunIds.add(run.id);
      }
    }
  }
  for (const runId of [...affectedRunIds].sort()) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${CHALLENGE_PROGRESSION_LOCK_NAMESPACE}),
        hashtext(${challengeRunLockKey(runId)})
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
