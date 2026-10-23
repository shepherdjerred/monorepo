import { z } from "zod";
import type { Prisma, RecoveryIntent } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Database } from "./database.ts";
import type { Transaction } from "./delivery-data.ts";
import { required } from "./delivery-records.ts";

/** The reader that settles an intent; every kind shares the one table (model 4.15). */
export type RecoveryIntentKind =
  "argo" | "worker" | "minecraft" | "platform" | "content";

const StoredFingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export function storedFingerprint(hex: string) {
  return StoredFingerprint.parse(`sha256:${hex}`);
}
export function bareFingerprint(stored: string) {
  return StoredFingerprint.parse(stored).slice(7);
}
const Detail = z.record(z.string(), z.unknown());
/** Stored detail is JSON written by `createIntent`; reparse it as JSON input. */
const DetailObject = z.custom<Prisma.InputJsonObject>(
  (value) => Detail.safeParse(value).success,
);
export function intentDetail(row: Pick<RecoveryIntent, "detail">) {
  return Detail.parse(row.detail);
}

export async function findIntent(
  database: Transaction | Database,
  intentId: string,
  kind: RecoveryIntentKind,
) {
  const row = required(
    await database.recoveryIntent.findUnique({ where: { id: intentId } }),
    `${kind} recovery intent`,
  );
  if (row.kind !== kind)
    throw new DeliveryError("NOT_FOUND", `${kind} recovery intent not found`);
  return row;
}

/** Fields every per-kind view shares, in the shape the existing contracts expect. */
export function legacyIntentFields(row: RecoveryIntent) {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    requestedBy: row.requestedBy,
    reason: row.reason,
    expectedEnvironmentGeneration: row.expectedGeneration,
    snapshotFingerprint: bareFingerprint(row.fingerprint),
    status: row.status,
    workflowId: row.workflowId,
    submittedAt: row.submittedAt,
    message: row.message,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

export async function createIntent(
  tx: Transaction,
  input: {
    id: string;
    kind: RecoveryIntentKind;
    deploymentId: string;
    requestedBy: string;
    reason: string;
    expectedGeneration: number;
    snapshotFingerprint: string;
    workflowId?: string;
    step?: string;
    detail?: Prisma.InputJsonObject;
  },
) {
  const sequence =
    (await tx.recoveryIntent.count({
      where: { deploymentId: input.deploymentId },
    })) + 1;
  return tx.recoveryIntent.create({
    data: {
      id: input.id,
      kind: input.kind,
      deploymentId: input.deploymentId,
      sequence,
      step: input.step ?? null,
      requestedBy: input.requestedBy,
      reason: input.reason,
      expectedGeneration: input.expectedGeneration,
      fingerprint: storedFingerprint(input.snapshotFingerprint),
      workflowId: input.workflowId ?? null,
      detail: input.detail ?? {},
    },
  });
}

/** Merge kind-specific frozen state; keys are never removed. */
export async function updateIntentDetail(
  tx: Transaction,
  intentId: string,
  patch: Prisma.InputJsonObject,
  data: Prisma.RecoveryIntentUpdateInput = {},
) {
  const stored = await tx.recoveryIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const current = DetailObject.parse(stored.detail);
  return tx.recoveryIntent.update({
    where: { id: intentId },
    data: { ...data, detail: { ...current, ...patch } },
  });
}
