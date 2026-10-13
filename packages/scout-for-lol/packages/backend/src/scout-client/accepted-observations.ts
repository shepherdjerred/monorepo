import { prisma } from "#src/database/index.ts";
import type { ScoutClientObservationBatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { observedPostGameMatchId } from "./lobby-payload.ts";

/** Partial accepted evidence can still reconcile an exact managed-game binding. */
export function acceptedClientBindingMatchIds(
  batch: ScoutClientObservationBatch,
  receipts: readonly { observationId: string; outcome: string }[],
): readonly RiotMatchId[] {
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  const matchIds = new Set<RiotMatchId>();
  for (const observation of batch.observations) {
    if (!accepted.has(observation.observationId)) continue;
    const matchId = observedPostGameMatchId(observation);
    if (matchId !== null) matchIds.add(matchId);
  }
  return [...matchIds].sort((left, right) => left.localeCompare(right));
}

/** Routing metadata is derived at acceptance, independently of the sent body. */
export async function acceptedObservationPlatforms(
  ids: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const rows = await prisma.scoutClientObservation.findMany({
    where: { observationId: { in: [...ids] }, disposition: "ACCEPTED" },
    select: { observationId: true, platformId: true },
  });
  return new Map(rows.map((row) => [row.observationId, row.platformId]));
}
