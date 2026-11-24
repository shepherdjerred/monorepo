import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { queueOperation } from "#automation/store.ts";
import { recordedAcquisitionIdentity } from "#shared/acquisition/recorded-identity.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { PLEX_EXCLUSION_PROOF_REQUIRED } from "./proof.ts";

const JsonValue: z.ZodType<Prisma.InputJsonValue | null> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);
const SkipWakePayload = z.union([
  z.object({ movieRetryV1: z.unknown() }),
  z.object({ movieRetryV2: z.unknown() }),
  z.object({ movieRetryPlexAckV1: z.unknown() }),
]);
const SeriesPackResult = z.object({ seriesPackSelectionV1: z.unknown() });
const ProofRequiredReasonSchema = z.object({
  reason: z.literal(PLEX_EXCLUSION_PROOF_REQUIRED),
});

export type WakeScope = {
  runId: string;
  recoveryEpoch: number;
  topologyKind: "movie" | "episode";
  now: Date;
};

type BlockedOp = Awaited<
  ReturnType<Prisma.TransactionClient["operation"]["findMany"]>
>[number];

export async function inspectMovieReservationBlock(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
): Promise<
  | { kind: "none" }
  | { kind: "active" }
  | { kind: "exclusion_blocked"; attemptId: string }
> {
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
    select: {
      attemptId: true,
      attempt: { select: { coordinatorOperationId: true, operationId: true } },
    },
  });
  if (reservation === null) return { kind: "none" };
  const coordinatorId =
    reservation.attempt.coordinatorOperationId ??
    reservation.attempt.operationId;
  const coordinator = await tx.operation.findUnique({
    where: { id: coordinatorId },
    select: { status: true, result: true },
  });
  return coordinator?.status === "reconciling" &&
    ProofRequiredReasonSchema.safeParse(coordinator.result).success
    ? { kind: "exclusion_blocked", attemptId: reservation.attemptId }
    : { kind: "active" };
}

export async function wakeBlockedExclusionOperations(
  tx: Prisma.TransactionClient,
  input: WakeScope,
): Promise<void> {
  const movieKinds = [
    "reconcile_movie_edition_v4",
    "acquire_movie_edition_v4",
    "reconcile_media",
    "acquire_release",
  ];
  const operations = await tx.operation.findMany({
    where: {
      status: "reconciling",
      result: { path: ["reason"], equals: PLEX_EXCLUSION_PROOF_REQUIRED },
      payload: { path: ["recoveryEpoch"], equals: input.recoveryEpoch },
      kind: {
        in:
          input.topologyKind === "movie"
            ? movieKinds
            : ["reconcile_media", "acquire_release"],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  for (const op of operations)
    await wakeSingleExclusionOperation(tx, op, input);
}

async function wakeSingleExclusionOperation(
  tx: Prisma.TransactionClient,
  op: BlockedOp,
  input: WakeScope,
): Promise<void> {
  if (op.targetId === null) return;
  if (op.kind === "reconcile_media" || op.kind === "acquire_release") {
    const media = await tx.mediaItem.findUnique({
      where: { id: op.targetId },
      select: { kind: true },
    });
    if (
      media === null ||
      (input.topologyKind === "movie") !== (media.kind === "movie")
    ) {
      return;
    }
  }
  const attempt = await tx.acquisitionAttempt.findFirst({
    where: { OR: [{ operationId: op.id }, { coordinatorOperationId: op.id }] },
  });
  if (attempt === null)
    return wakeUnstartedExclusionOperation(tx, op, op.targetId, input);
  await wakeReservedExclusionAttempt(tx, op.id, attempt, input);
}

async function wakeUnstartedExclusionOperation(
  tx: Prisma.TransactionClient,
  op: BlockedOp,
  targetId: string,
  input: WakeScope,
): Promise<void> {
  if (SkipWakePayload.safeParse(op.payload).success) return;
  const {
    operationId: _id,
    kind: _kind,
    recoveryEpoch: _epoch,
    ...payload
  } = z.record(z.string(), JsonValue).parse(op.payload);
  const wokenOperationId = await queueOperation(tx, {
    key: `plex-exclusion-wake:${input.runId}:${op.id}`,
    kind: op.kind,
    targetId,
    ...(op.userId === null ? {} : { userId: op.userId }),
    createdAt: input.now,
    availableAt: input.now,
    payload,
  });
  if (SeriesPackResult.safeParse(op.result).success) return;
  const patch = JSON.stringify({
    wokenByExclusionRunId: input.runId,
    wokenOperationId,
  });
  await tx.$executeRaw`UPDATE "Operation" SET status = 'completed'::"OperationStatus", result = COALESCE(result, '{}'::jsonb) || ${patch}::jsonb, "updatedAt" = NOW() WHERE id = ${op.id}`;
}

async function wakeReservedExclusionAttempt(
  tx: Prisma.TransactionClient,
  operationId: string,
  attempt: NonNullable<
    Awaited<
      ReturnType<Prisma.TransactionClient["acquisitionAttempt"]["findFirst"]>
    >
  >,
  input: WakeScope,
): Promise<void> {
  if (
    ["completed", "obsolete", "rejected", "cancelled", "failed"].includes(
      attempt.state,
    )
  ) {
    return;
  }
  const identity = recordedAcquisitionIdentity(attempt.identityEvidence);
  if (identity?.schemaVersion === 2 || identity?.schemaVersion === 3) {
    const patch = JSON.stringify({ exclusionVerifiedRunId: input.runId });
    await tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${patch}::jsonb, "updatedAt" = NOW() WHERE id = ${operationId}`;
    return;
  }
  const mediaId = attempt.mediaIds[0];
  if (mediaId === undefined) return;
  const intent = await tx.mediaIntent.findUnique({
    where: { mediaId_edition: { mediaId, edition: "default" } },
  });
  if (
    intent === null ||
    !intent.desiredPresence ||
    !intent.monitoring ||
    intent.intentionallyRemovedAt !== null ||
    intent.automationEpoch !== input.recoveryEpoch
  ) {
    return;
  }
  await queueOperation(tx, {
    key: `plex-exclusion-wake:${input.runId}:${attempt.id}`,
    kind: "reconcile_media",
    targetId: mediaId,
    createdAt: input.now,
    availableAt: input.now,
    payload: { mediaId, generation: intent.generation },
  });
}
