import {
  Prisma,
  type MediaCapacityObservation,
} from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  CapacityCycleSchema,
  CapacitySampleTokenSchema,
  CapacitySampleStartSchema,
  CapacitySampleResultSchema,
  type CapacityCycle,
  type CapacitySampleToken,
  type CapacitySampleResult,
  type CapacitySampleStart,
  type CapacitySampleReason,
} from "#shared/capacity/contract.ts";
import { serializable } from "#automation/store.ts";
import { lockCapacity, matchesCycle } from "./ordering.ts";
import { readSampleBinding } from "./binding.ts";
import { assertActive, type CapacityExecution } from "./execution.ts";

function unavailable(
  row: MediaCapacityObservation,
  reason: CapacitySampleReason,
  now: Date,
): Prisma.MediaCapacityObservationUpdateInput {
  if (row.sampleAttemptStartedAt === null)
    throw new Error("Capacity sample attempt missing");
  return {
    sampleResultAttempt: row.sampleAttempt,
    sampleOutcome: "unavailable",
    sampleReason: reason,
    sampleEpoch: row.cycleEpoch,
    sampleStartedAt: row.sampleAttemptStartedAt,
    sampleCompletedAt: now,
    sampleObservedAt: null,
    sampleBinding: Prisma.DbNull,
    sampleBindingDigest: null,
    sampleIdentity: Prisma.DbNull,
    totalBytes: null,
    availableBytes: null,
  };
}

export async function beginCapacitySample(
  db: Database,
  raw: CapacityCycle,
  execution: CapacityExecution,
): Promise<CapacitySampleStart> {
  const cycle = CapacityCycleSchema.parse(raw);
  return await serializable(db, async (tx) => {
    assertActive(execution);
    const runtime = await lockCapacity(tx, execution);
    const rows = await tx.mediaCapacityObservation.findMany({
      orderBy: { role: "asc" },
    });
    if (!matchesCycle(rows, cycle, runtime.recoveryEpoch))
      return { status: "superseded" };
    const now = new Date();
    const roles = [];
    for (const entry of cycle.cycles) {
      assertActive(execution);
      const row = await tx.mediaCapacityObservation.update({
        where: { role: entry.role },
        data: {
          sampleAttempt: { increment: 1 },
          sampleAttemptCycle: BigInt(entry.revision),
          sampleAttemptStartedAt: now,
        },
      });
      const proof = readSampleBinding(row, now);
      if (proof.status === "unavailable") {
        await tx.mediaCapacityObservation.update({
          where: { role: entry.role },
          data: unavailable(row, proof.reason, now),
        });
        roles.push({
          status: "unavailable",
          role: entry.role,
          reason: proof.reason,
        });
      } else {
        roles.push({
          status: "ready",
          token: {
            role: entry.role,
            recoveryEpoch: runtime.recoveryEpoch,
            cycleRevision: entry.revision,
            sampleAttempt: String(row.sampleAttempt),
            bindingDigest: row.mountBindingDigest,
          },
          binding: proof.binding,
        });
      }
      assertActive(execution);
    }
    return CapacitySampleStartSchema.parse({ status: "started", roles });
  });
}

export async function finishCapacitySample(
  db: Database,
  rawToken: CapacitySampleToken,
  rawResult: CapacitySampleResult,
  execution: CapacityExecution,
): Promise<"stored" | "superseded"> {
  const token = CapacitySampleTokenSchema.parse(rawToken);
  const result = CapacitySampleResultSchema.parse(rawResult);
  return await serializable(db, async (tx) => {
    assertActive(execution);
    const runtime = await lockCapacity(tx, execution);
    const row = await tx.mediaCapacityObservation.findUniqueOrThrow({
      where: { role: token.role },
    });
    if (
      runtime.recoveryEpoch !== token.recoveryEpoch ||
      row.cycleEpoch !== token.recoveryEpoch ||
      row.cycleRevision !== BigInt(token.cycleRevision) ||
      row.sampleAttempt !== BigInt(token.sampleAttempt) ||
      row.sampleAttemptCycle !== row.cycleRevision ||
      row.sampleResultAttempt === row.sampleAttempt ||
      row.mountBindingDigest !== token.bindingDigest
    )
      return "superseded";
    const now = new Date();
    const proof = readSampleBinding(row, now);
    let data: Prisma.MediaCapacityObservationUpdateInput;
    if (proof.status === "unavailable")
      data = unavailable(row, proof.reason, now);
    else if (result.status === "unavailable")
      data = unavailable(row, result.reason, now);
    else {
      const observedAt = new Date(result.observedAt);
      if (
        row.sampleAttemptStartedAt === null ||
        observedAt < row.sampleAttemptStartedAt ||
        observedAt > now
      )
        throw new Error("Invalid capacity sample observation time");
      data = {
        sampleResultAttempt: row.sampleAttempt,
        sampleOutcome: "observed",
        sampleReason: null,
        sampleEpoch: token.recoveryEpoch,
        sampleStartedAt: row.sampleAttemptStartedAt,
        sampleObservedAt: observedAt,
        sampleCompletedAt: now,
        sampleBinding: proof.binding,
        sampleBindingDigest: token.bindingDigest,
        sampleIdentity: result.identity,
        totalBytes: result.totalBytes,
        availableBytes: result.availableBytes,
      };
    }
    assertActive(execution);
    await tx.mediaCapacityObservation.update({
      where: { role: token.role },
      data,
    });
    assertActive(execution);
    return "stored";
  });
}
