import { z } from "zod";
import { EvidenceInputSchema } from "#shared/evidence-contract.ts";
import {
  failureReason,
  readbackPhase,
  recoveryReading,
  type CauseStage,
  type ReadableIntent,
} from "#shared/evidence/recovery-reading.ts";
import type { Database } from "#infrastructure/database.ts";

const EvidenceListSchema = z.array(EvidenceInputSchema);

/** A recovery intent row's status as an outcome: anything unsettled is pending. */
function outcome(status: string): ReadableIntent["outcome"] {
  return status === "succeeded" || status === "failed" ? status : "pending";
}

/**
 * The recovery intents of each deployment, by deployment id: one read for
 * every id, never one per deployment.
 */
export async function recoveryIntentsOf(
  database: Database,
  deploymentIds: Iterable<string>,
): Promise<ReadonlyMap<string, ReadableIntent[]>> {
  const ids = [...new Set(deploymentIds)];
  if (ids.length === 0) return new Map();
  const rows = await database.recoveryIntent.findMany({
    where: { deploymentId: { in: ids } },
    select: {
      id: true,
      deploymentId: true,
      sequence: true,
      status: true,
      evidence: true,
    },
  });
  const intents = new Map<string, ReadableIntent[]>();
  for (const row of rows)
    intents.set(row.deploymentId, [
      ...(intents.get(row.deploymentId) ?? []),
      {
        id: row.id,
        sequence: row.sequence,
        outcome: outcome(row.status),
        evidence: EvidenceListSchema.parse(row.evidence),
      },
    ]);
  return intents;
}

/**
 * The steps of each deployment whose recovery settled, by deployment id:
 * what recovery read back is never why the deployment failed; the step that
 * failed or the one it ended on is, and only the steps hold that. One read
 * for every such deployment.
 */
export async function causeStagesOf(
  database: Database,
  intents: ReadonlyMap<string, readonly ReadableIntent[]>,
): Promise<ReadonlyMap<string, CauseStage[]>> {
  const ids = [...intents]
    .filter(([, own]) => recoveryReading(own) !== null)
    .map(([id]) => id);
  if (ids.length === 0) return new Map();
  const rows = await database.stage.findMany({
    where: { deploymentId: { in: ids } },
    select: {
      deploymentId: true,
      key: true,
      status: true,
      message: true,
    },
    orderBy: [{ startedAt: "asc" }, { updatedAt: "asc" }],
  });
  const stages = new Map<string, CauseStage[]>();
  for (const { deploymentId, ...stage } of rows)
    stages.set(deploymentId, [...(stages.get(deploymentId) ?? []), stage]);
  return stages;
}

/**
 * A deployment with its message as every page states it: once its newest
 * recovery intent has settled, what recovery read back replaces what the
 * executor said while the outcome was unknown.
 */
export function stated<
  T extends { id: string; message: string | null; recoveryRequired: boolean },
>(
  row: T,
  intents: ReadonlyMap<string, readonly ReadableIntent[]>,
  stages: ReadonlyMap<string, readonly CauseStage[]>,
): T {
  return {
    ...row,
    message: failureReason(row, intents.get(row.id), stages.get(row.id) ?? []),
  };
}

/**
 * The phase recovery read back for a step its deployment outlived, or null
 * while nothing has settled it or no readback answers for it.
 */
export function steppedReadback(
  intents: readonly ReadableIntent[] | undefined,
  stage: { operationId: string },
) {
  const reading = recoveryReading(intents);
  return reading === null ? null : readbackPhase(reading, stage);
}
