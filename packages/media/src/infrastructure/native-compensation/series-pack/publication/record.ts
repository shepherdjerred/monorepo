import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  SeriesPackNativePublicationCommandV2Schema,
  SeriesPackNativeVerifiedPublicationV2Schema,
  SeriesPackNativeFenceReleaseV2Schema,
  type SeriesPackNativeActivityV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";

export const SeriesPackNativePublicationEnvelopeV2Schema =
  SeriesPackNativePublicationCommandV2Schema.extend({
    kind: z.literal("publish_series_pack_native_compensation_v1"),
    operationId: z.uuid(),
  });

export function seriesPackNativePublicationIdentityV1(
  record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>,
) {
  if (record.completion === null)
    throw new Error(
      "Native pack serving authority requires its real completed inverse",
    );
  return {
    completionHash: identityHash(record.completion),
    bindingsHash: identityHash(record.completion.predecessorBindings),
    assets: record.completion.predecessorBindings.map(({ after }) => ({
      assetId: after.id,
      assetVersion: after.version,
      checksum: after.checksum,
      mediaIds: after.coverage
        .filter((row) => row.current)
        .map((row) => row.mediaId),
    })),
  };
}

export function assertSeriesPackNativePublicationCommandV1(
  record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>,
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  input: SeriesPackNativeActivityV1,
) {
  const { kind, operationId, ...command } =
    SeriesPackNativePublicationEnvelopeV2Schema.parse(operation.payload);
  const identity = seriesPackNativePublicationIdentityV1(record);
  if (
    operation.kind !== kind ||
    operation.id !== operationId ||
    operation.id !== input.operationId ||
    operation.targetId !== record.row.id ||
    operation.userId !== record.row.receipt.actorId ||
    record.row.publicationCoordinatorOperationId !== operation.id ||
    input.continuationId !== record.row.id ||
    input.recoveryEpoch !== record.row.recoveryEpoch ||
    command.continuationId !== record.row.id ||
    command.recoveryEpoch !== record.row.recoveryEpoch ||
    command.completionRaw !==
      canonicalJson(z.json().parse(record.completion)) ||
    command.bindingsRaw !==
      canonicalJson(z.json().parse(record.completion?.predecessorBindings)) ||
    command.completionHash !== identity.completionHash ||
    command.bindingsHash !== identity.bindingsHash
  )
    throw new Error(
      "Native pack serving command lost its literal completed parent or current coordinator",
    );
  return { ...identity, command, commandHash: identityHash(command) };
}

/** Literal terminal ACK: current demand/epoch changes cannot erase a real publication. */
export async function readSeriesPackNativePublicationV1(
  tx: Prisma.TransactionClient,
  input: SeriesPackNativeActivityV1,
  budget: PublicationAuthorityReadBudget,
) {
  const locator =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: { verifiedPublication: true },
    });
  budget.consume(1);
  if (locator.verifiedPublication === null) return null;
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    input.continuationId,
    budget,
  );
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const identity = assertSeriesPackNativePublicationCommandV1(
    record,
    operation,
    input,
  );
  const proof = SeriesPackNativeVerifiedPublicationV2Schema.parse(
    record.row.verifiedPublication,
  );
  const release = SeriesPackNativeFenceReleaseV2Schema.parse(
    record.row.fenceRelease,
  );
  const assertServingReceipt1 = () => {
    if (
      identityHash(locator.verifiedPublication) !== identityHash(proof) ||
      proof.continuationId !== record.row.id ||
      proof.operationId !== operation.id ||
      proof.recoveryEpoch !== record.row.recoveryEpoch ||
      proof.completionHash !== identity.completionHash ||
      proof.bindingsHash !== identity.bindingsHash ||
      proof.commandHash !== identity.commandHash ||
      proof.commandRaw !== canonicalJson(z.json().parse(identity.command))
    )
      throw new Error(
        "Native pack verified serving receipt or exact fence release changed",
      );
  };
  assertServingReceipt1();
  const assertServingReceipt2 = () => {
    if (
      identityHash(proof.generations) !==
        identityHash(identity.command.generations) ||
      proof.items.length !== record.row.mediaIds.length ||
      new Set(proof.items.map((item) => item.mediaId)).size !==
        record.row.mediaIds.length ||
      proof.items.some(
        (item) =>
          record.completion?.predecessorBindings.some(
            ({ after }) =>
              after.id === item.assetId &&
              after.version === item.assetVersion &&
              after.checksum === item.checksum &&
              after.path === item.canonicalPath &&
              after.coverage.some(
                (row) => row.current && row.mediaId === item.mediaId,
              ),
          ) !== true,
      ) ||
      release.continuationId !== record.row.id ||
      release.transitionId !== record.row.transitionId ||
      release.settlingContinuationId !== record.row.id ||
      release.settlingCompletionHash !== identity.completionHash
    )
      throw new Error(
        "Native pack verified serving receipt or exact fence release changed",
      );
  };
  assertServingReceipt2();
  const assertServingReceipt3 = () => {
    if (
      release.publicationHash !== identityHash(proof) ||
      release.publicationRaw !== canonicalJson(z.json().parse(proof)) ||
      release.releasedAt !== proof.verifiedAt
    )
      throw new Error(
        "Native pack verified serving receipt or exact fence release changed",
      );
  };
  assertServingReceipt3();
  return { record, operation, ...identity, proof, release };
}

export function seriesPackNativeContinuationHashV1(
  row: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>["row"],
) {
  const { receipt: _receipt, ...continuation } = row;
  return identityHash(nativeJson(continuation));
}
