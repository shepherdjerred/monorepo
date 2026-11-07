import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import { movieLibraryParentV2FromReceipt } from "#infrastructure/movie-editions/library-records.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";
import { LibraryMigrationBundleV2Schema } from "#shared/handoff/library-bundle.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieHistoryConflict } from "./locks.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** The one actual initial-library grant for this cut, never a latest-by-title receipt guess. */
export async function movieHistoryAdoptionSourceV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  const original = await maybeMovieHistoryAdoptionSourceV3(tx, input, budget);
  if (original === null)
    throw movieHistoryConflict(
      "This cut needs its actual initial-library ownership receipt",
    );
  return original;
}

export async function maybeMovieHistoryAdoptionSourceV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  const candidates = await tx.mediaHandoffReceipt.findMany({
    where: {
      recoveryEpoch: input.epoch,
      selection: {
        path: ["scope", "targets"],
        array_contains: [
          { mediaId: input.scope.mediaId, edition: input.scope.edition },
        ],
      },
    },
    orderBy: { id: "asc" },
    take: Math.min(2, budget.take),
    select: { id: true },
  });
  budget.consume(candidates.length);
  if (candidates.length === 0) return null;
  const candidate = candidates[0];
  if (candidate === undefined || candidates.length !== 1)
    throw movieHistoryConflict(
      "This cut needs its one exact actual initial-library ownership receipt",
    );
  const original = await readLibraryHandoffReceipt(tx, candidate.id, budget);
  const files = original.selection.scope.files.filter(
    (file) =>
      file.libraryKind === "movies" &&
      file.edition === input.scope.edition &&
      hash(file.mediaIds) === hash([input.scope.mediaId]),
  );
  const file = files[0];
  if (file === undefined || files.length !== 1)
    throw new Error(
      "Movie household history changed its exact initial physical file",
    );
  const parent = movieLibraryParentV2FromReceipt({
    ...original,
    assetId: file.assetId,
  });
  if (hash(parent.asset.scope) !== hash(input.scope))
    throw new Error("Movie household history source belongs to another cut");
  const approval = await tx.migrationBundleReview.findUniqueOrThrow({
    where: { id: original.selection.scope.request.bundleReviewId },
    include: { bundle: true },
  });
  budget.consume(2);
  const report = BundleReportSchema.parse(approval.report);
  const manifest = LibraryMigrationBundleV2Schema.parse(
    approval.bundle.manifest,
  );
  if (
    approval.reportHash !== original.selection.scope.request.reportHash ||
    report.reportHash !== approval.reportHash ||
    approval.bundle.bundleHash !== manifest.bundleHash ||
    report.bundleHash !== manifest.bundleHash ||
    original.selection.scope.request.bundleHash !== manifest.bundleHash
  )
    throw new Error(
      "Movie household history lost its literal approved capture report",
    );
  return {
    adoption: {
      receiptId: original.receipt.id,
      planId: original.receipt.planId,
      planHash: original.receipt.planHash,
      assetId: parent.asset.id,
      bindingHash: parent.reference.bindingHash,
      actorId: original.receipt.actorId,
      assetRaw: canonicalJson(nativeJson(parent.asset)),
      planRaw: canonicalJson(nativeJson(original.receipt.plan.plan)),
    },
    report,
    libraryParentSqlRows:
      original.selection.schemaVersion === 3
        ? 3 +
          original.selection.plexEdits.reduce(
            (count, edit) => count + 1 + (edit.intent === null ? 0 : 1),
            0,
          )
        : 2,
  };
}
