import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieReplacementSnapshotV2Schema,
  MovieReplacementReceiptV2Schema,
  type MovieReplacementSourceV2,
  type MovieReplacementSnapshotV2,
  type MovieReplacementReceiptV2,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { readMovieSubtitleCompletionV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { readMovieReplacementVideoParentV2 } from "./video-parent.ts";
import {
  assertMovieReplacementReceiptBindingV2,
  assertMovieReplacementReceiptTransitionV2,
} from "./receipt-validation.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import type {
  MoviePublicationAssetV2,
  MoviePublicationReferenceV2,
} from "#shared/movie-editions/publication-v2.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
export type MovieReplacementRecordV2 = {
  row: Prisma.SubtitleReplacementGetPayload<{ include: { receipt: true } }>;
  snapshot: MovieReplacementSnapshotV2;
  receipt: MovieReplacementReceiptV2;
  receiptHash: string;
  asset: MoviePublicationAssetV2;
};
type PhysicalSource = {
  asset: MoviePublicationAssetV2;
  publication: MoviePublicationReferenceV2;
};

/** Literal source receipts only: historical acknowledgement never consults current permission. */
export async function readMovieReplacementReceiptV2(
  tx: Prisma.TransactionClient,
  replacementId: string,
  budget: PublicationAuthorityReadBudget,
): Promise<MovieReplacementRecordV2 | null> {
  const row = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { receipt: true },
  });
  budget.consume(row.receipt === null ? 1 : 2);
  const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
  if (hash(snapshot) !== row.snapshotHash)
    throw new Error("Movie caption replacement snapshot hash changed");
  if (row.receipt === null) return null;
  const receipt = MovieReplacementReceiptV2Schema.parse(row.receipt.evidence);
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: receipt.command.operationId },
  });
  budget.consume(1);
  assertMovieReplacementReceiptBindingV2(row, snapshot, receipt, command);
  assertMovieReplacementReceiptTransitionV2(
    { ...row, receipt: row.receipt },
    snapshot,
    receipt,
  );
  const parent = await readMovieReplacementSourceV2(
    tx,
    {
      source: snapshot.source,
      scope: snapshot.scope,
      old: NativeSubtitleSnapshotSchema.parse(snapshot.old),
    },
    budget,
  );
  if (
    hash(parent.publication) !== hash(snapshot.publication) ||
    parent.asset.id !== snapshot.asset.id ||
    parent.asset.version !== snapshot.asset.version ||
    parent.asset.path !== snapshot.asset.path ||
    parent.asset.checksum !== snapshot.asset.checksum ||
    parent.asset.ownershipEpoch !== snapshot.asset.ownershipEpoch
  )
    throw new Error("Movie replacement changed its exact source video parent");
  return {
    row,
    snapshot,
    receipt,
    receiptHash: hash(row.receipt.evidence),
    asset: parent.asset,
  };
}

/** An old caption belongs either to its exact video baseline or its actual installed receipt. */
export async function readMovieReplacementSourceV2(
  tx: Prisma.TransactionClient,
  input: {
    source: MovieReplacementSourceV2;
    scope: MovieEditionScope;
    old: NativeSubtitleSnapshot;
  },
  budget: PublicationAuthorityReadBudget,
): Promise<PhysicalSource> {
  const source = input.source;
  if (source.kind === "installation_v4") {
    const completion = await readMovieSubtitleCompletionV4(
      tx,
      source.input,
      budget,
    );
    if (
      completion === null ||
      hash(completion.receipt) !== source.receiptHash ||
      hash(completion.receipt.after) !== hash(input.old) ||
      hash(source.input.scope) !== hash(input.scope)
    )
      throw new Error(
        "Movie caption replacement lost its original installation receipt",
      );
    return {
      asset: completion.asset,
      publication: completion.receipt.publication,
    };
  }
  if (source.kind === "replacement_v2") {
    const previous = await readMovieReplacementReceiptV2(
      tx,
      source.replacementId,
      budget,
    );
    if (
      previous === null ||
      previous.row.receipt?.id !== source.receiptId ||
      previous.row.receipt.outcome !== "installed" ||
      previous.receiptHash !== source.receiptHash ||
      hash(previous.snapshot.scope) !== hash(input.scope) ||
      hash(previous.receipt.after.candidate) !== hash(input.old)
    )
      throw new Error(
        "Movie caption replacement lost its exact previous replacement",
      );
    return {
      asset: previous.asset,
      publication: previous.snapshot.publication,
    };
  }
  const reference = source.publication;
  if (
    hash(reference.scope) !== hash(input.scope) ||
    reference.assetId !== input.old.assetId
  )
    throw new Error("Movie caption replacement baseline has another edition");
  const asset = await readMovieReplacementVideoParentV2(tx, reference, budget);
  if (!asset.subtitles.some((row) => hash(row) === hash(input.old)))
    throw new Error(
      "Movie caption replacement baseline does not own this old caption",
    );
  return { asset, publication: reference };
}
