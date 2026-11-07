import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError } from "#application/errors.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { SeriesPackNativeRetryV1Schema } from "#shared/native-recovery/series-pack/retry.ts";
import type { SeriesPackNativeCommandInvocationV1 } from "./command-invocation.ts";
import type { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

type Row = Prisma.NativePublicationCompensationContinuationGetPayload<
  Record<string, never>
>;
type Describe = MediaAutomationContext["describeWorkflow"];
export type SeriesPackNativeClosedRetryV1 = {
  initial: Row;
  closed: z.infer<typeof ClosedCoordinatorObservationSchema> | null;
};

function conflict(message: string) {
  return new MediaError("compensation_retry_changed", message, 409);
}

/** SDK observation is made before locks, under this command's original clock.
 * Unknown or running executions cannot authorize a new owner. */
export async function observeSeriesPackNativeRetryV1(
  db: Database,
  id: string,
  describe: Describe | undefined,
  invocation: SeriesPackNativeCommandInvocationV1,
): Promise<SeriesPackNativeClosedRetryV1> {
  invocation.freshness.assertActive();
  const initial =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id },
    });
  invocation.budget.consume(1);
  const operationId =
    initial.completion === null
      ? initial.coordinatorOperationId
      : initial.publicationCoordinatorOperationId;
  if (operationId === null) {
    if (initial.completion === null)
      throw new Error("Native pack physical coordinator missing");
    return { initial, closed: null };
  }
  if (describe === undefined)
    throw new Error("Native pack retry requires Workflow description");
  let observed;
  try {
    observed = await describe(`media-operation-${operationId}`);
  } catch {
    invocation.freshness.assertActive();
    throw conflict("The exact previous recovery executor is unknown");
  }
  invocation.freshness.assertActive();
  if (observed === null)
    throw conflict("The exact previous recovery executor is unknown");
  const closed = ClosedCoordinatorObservationSchema.safeParse({
    operationId,
    workflowId: `media-operation-${operationId}`,
    runId: observed.runId,
    status: observed.status,
    observedAt: new Date().toISOString(),
  });
  if (!closed.success)
    throw conflict("The exact previous recovery executor must be terminal");
  return { initial, closed: closed.data };
}

export function assertSeriesPackNativeRetryCasV1(
  record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>,
  expected: { version: number; actorId: string },
  observed: SeriesPackNativeClosedRetryV1,
) {
  const { row } = record;
  const before = observed.initial;
  if (
    row.version !== expected.version ||
    row.version !== before.version ||
    row.receipt.actorId !== expected.actorId ||
    row.fenceRelease !== null ||
    row.state === "superseded" ||
    row.descriptorHash !== before.descriptorHash ||
    row.coordinatorOperationId !== before.coordinatorOperationId ||
    row.publicationCoordinatorOperationId !==
      before.publicationCoordinatorOperationId ||
    identityHash(row.completion) !== identityHash(before.completion)
  )
    throw conflict("Refresh the complete native recovery before retrying");
}

/** The current pointer update consumes the actual immutable marker in this
 * SAME transaction. Eight SQL parents are reserved before either write. */
export async function recordSeriesPackNativeRetryV1(
  tx: Prisma.TransactionClient,
  input: {
    record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>;
    operationId: string;
    closed: z.infer<typeof ClosedCoordinatorObservationSchema>;
    phase: "physical" | "publication";
  },
  invocation: SeriesPackNativeCommandInvocationV1,
) {
  const { record, operationId, closed, phase } = input;
  if (record.transaction !== tx || record.budget !== invocation.budget)
    throw new Error("Native retry lost its original transaction or allowance");
  invocation.freshness.assertActive();
  invocation.budget.consume(8);
  const [transaction] = z
    .array(z.strictObject({ id: z.string().regex(/^[1-9]\d*$/u) }))
    .length(1)
    .parse(await tx.$queryRaw`SELECT txid_current()::text AS id`);
  if (transaction === undefined)
    throw new Error("Native retry actual transaction missing");
  const proof = SeriesPackNativeRetryV1Schema.parse({
    schemaVersion: 1,
    continuationId: record.row.id,
    descriptorHash: record.row.descriptorHash,
    recoveryEpoch: record.row.recoveryEpoch,
    previousVersion: record.row.version,
    previousWorkflowClosed: closed,
    phase,
    operationId,
    actorId: record.row.receipt.actorId,
    transactionId: transaction.id,
    observedAt: new Date(invocation.observed.wall).toISOString(),
    expiresAt: new Date(invocation.freshness.expiresAtMs).toISOString(),
  });
  await tx.operation.update({
    where: { id: operationId },
    data: { result: { seriesPackNativeRetryV1: proof } },
  });
  invocation.freshness.assertActive();
}
