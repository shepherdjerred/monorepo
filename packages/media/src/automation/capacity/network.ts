import type { Database } from "#infrastructure/database.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import {
  type CapacityMountActivityResult,
  type CapacityMountResult,
} from "#shared/capacity/contract.ts";
import { LegacyObservationError } from "#integrations/legacy-observer/wire.ts";
import { beginCapacityCycle } from "./ordering.ts";
import { finishCapacityMounts } from "./mounts.ts";
import { checkpoint, type CapacityExecution } from "./execution.ts";

export function createCapacityNetworkProducer(context: {
  db: Database;
  enabled: () => Promise<boolean>;
  observeMounts: (signal: AbortSignal) => Promise<unknown>;
}) {
  return async (
    execution: CapacityExecution,
  ): Promise<CapacityMountActivityResult> => {
    await checkpoint(execution);
    if (!(await context.enabled())) return { status: "disabled" };
    await checkpoint(execution);
    const cycle = await beginCapacityCycle(context.db, execution);
    await checkpoint(execution);
    let result: CapacityMountResult;
    try {
      const raw = await context.observeMounts(execution.signal);
      const proof = CanonicalMountEvidenceSchema.safeParse(raw);
      result = proof.success
        ? { status: "observed", evidence: proof.data }
        : { status: "unavailable", reason: "mount_proof_invalid" };
    } catch (error) {
      execution.signal.throwIfAborted();
      if (!(error instanceof LegacyObservationError)) throw error;
      result = { status: "unavailable", reason: "mount_observation_failed" };
    }
    await checkpoint(execution);
    const stored = await finishCapacityMounts(
      context.db,
      cycle,
      result,
      execution,
    );
    if (stored === "superseded") return { status: "superseded" };
    // Invalid/expired proof can be rejected by the final persistence boundary.
    const row = await context.db.mediaCapacityObservation.findUniqueOrThrow({
      where: { role: "movies" },
    });
    await checkpoint(execution);
    if (row.cycleRevision !== BigInt(cycle.cycles[0].revision))
      return { status: "superseded" };
    return row.mountOutcome === "observed"
      ? { status: "observed", cycle }
      : { status: "unavailable" };
  };
}
