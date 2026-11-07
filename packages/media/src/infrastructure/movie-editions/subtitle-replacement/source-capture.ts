import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  MoviePublicationAssetV2,
  MoviePublicationReferenceV2,
} from "#shared/movie-editions/publication-v2.ts";
import { readMovieSubtitleCompletionV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { readMovieRestorePublicationParentV1 } from "#infrastructure/movie-editions/publication/restore-records.ts";
import { loadMovieLibraryParentV2 } from "#infrastructure/movie-editions/library-records.ts";
import { readMovieReplacementReceiptV2 } from "./records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertMovieReplacementVideoV2 } from "./current-video.ts";
import { LibraryHandoffScopeV2Schema } from "#shared/handoff-v2.ts";
import { findMovieRollbackPublicationParentV1 } from "#infrastructure/movie-editions/rollback/parent.ts";
import {
  resolveHeldMovieRollbackCaptionSourceV1,
  type HeldMovieRollbackCaptionSourceV1,
} from "./rollback-source.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type CurrentVideo = Awaited<
  ReturnType<typeof currentMovieSubtitleWorkV4>
>["asset"];
type Parent = {
  asset: MoviePublicationAssetV2;
  reference: MoviePublicationReferenceV2;
};

/** Only the caption being changed supplies caption ancestry. Neighbors remain operational lock scope. */
export async function captureMovieReplacementSourceV2(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    asset: CurrentVideo;
    old: NativeSubtitleSnapshot;
  },
  budget: PublicationAuthorityReadBudget,
  heldRollbackSource?: HeldMovieRollbackCaptionSourceV1,
) {
  if (heldRollbackSource !== undefined)
    return resolveHeldMovieRollbackCaptionSourceV1(tx, input, {
      budget,
      source: heldRollbackSource,
    });
  return await captureLiteralMovieReplacementSourceV2(tx, input, budget);
}

async function captureLiteralMovieReplacementSourceV2(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    asset: CurrentVideo;
    old: NativeSubtitleSnapshot;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { old, scope, asset } = input;
  const markers = z
    .object({
      movieReplacementV2: z
        .strictObject({ schemaVersion: z.literal(2), replacementId: z.uuid() })
        .optional(),
      movieInstallationV4: z
        .strictObject({ schemaVersion: z.literal(4), operationId: z.uuid() })
        .optional(),
    })
    .parse(old.matchingEvidence);
  if (markers.movieReplacementV2 !== undefined) {
    const previous = await readMovieReplacementReceiptV2(
      tx,
      markers.movieReplacementV2.replacementId,
      budget,
    );
    if (previous?.row.receipt == null)
      throw new Error("Movie old caption replacement receipt missing");
    if (previous.snapshot.asset.version !== old.videoVersion)
      return baselineSource(tx, input, budget);
    if (
      hash(previous.receipt.after.candidate) !== hash(old) ||
      hash(previous.snapshot.scope) !== hash(scope)
    )
      throw new Error("Movie old caption differs from its actual replacement");
    assertMovieReplacementVideoV2(asset, previous.asset, scope);
    return {
      publication: previous.snapshot.publication,
      source: {
        kind: "replacement_v2" as const,
        replacementId: previous.row.id,
        receiptId: previous.row.receipt.id,
        receiptHash: previous.receiptHash,
      },
    };
  }
  if (markers.movieInstallationV4 !== undefined) {
    const installedInput = {
      schemaVersion: 4 as const,
      operationId: markers.movieInstallationV4.operationId,
      scope,
      assetId: old.assetId,
      subtitleId: old.id,
    };
    const completion = await readMovieSubtitleCompletionV4(
      tx,
      installedInput,
      budget,
    );
    if (completion === null)
      throw new Error("Movie old caption installation receipt missing");
    if (completion.receipt.after.videoVersion === old.videoVersion) {
      if (hash(completion.receipt.after) !== hash(old))
        throw new Error(
          "Movie old caption differs from its actual installation",
        );
      assertMovieReplacementVideoV2(asset, completion.asset, scope);
      return {
        publication: completion.receipt.publication,
        source: {
          kind: "installation_v4" as const,
          input: installedInput,
          receiptHash: hash(completion.receipt),
        },
      };
    }
  }
  return baselineSource(tx, input, budget);
}

async function baselineSource(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    asset: CurrentVideo;
    old: NativeSubtitleSnapshot;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const parent =
    input.asset.version > 0
      ? await restoredParent(tx, input, budget)
      : await adoptedParent(tx, input.asset, budget);
  assertMovieReplacementVideoV2(input.asset, parent.asset, input.scope);
  if (!parent.asset.subtitles.some((row) => hash(row) === hash(input.old)))
    throw new Error("Movie baseline does not own this exact old caption");
  return {
    publication: parent.reference,
    source: { kind: "video_baseline" as const, publication: parent.reference },
  };
}

async function restoredParent(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; asset: CurrentVideo },
  budget: PublicationAuthorityReadBudget,
): Promise<Parent> {
  const rows = await tx.operation.findMany({
    where: {
      kind: "restore_movie_edition_v4",
      AND: [
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "scope"],
            equals: input.scope,
          },
        },
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "after", "id"],
            equals: input.asset.id,
          },
        },
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "after", "version"],
            equals: input.asset.version,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length === 0) {
    const rollback = await findMovieRollbackPublicationParentV1(
      tx,
      {
        scope: input.scope,
        assetId: input.asset.id,
        assetVersion: input.asset.version,
      },
      budget,
    );
    if (rollback !== null) return rollback;
  }
  const operation = rows[0];
  if (operation === undefined || rows.length !== 1)
    throw new Error(
      "Movie changed caption version requires its one actual restore parent",
    );
  return readMovieRestorePublicationParentV1(tx, operation, budget);
}

async function adoptedParent(
  tx: Prisma.TransactionClient,
  asset: CurrentVideo,
  budget: PublicationAuthorityReadBudget,
): Promise<Parent> {
  const { planId } = z
    .object({
      libraryAdoptionV2: z.strictObject({
        schemaVersion: z.literal(2),
        planId: z.uuid(),
        edition: LibraryHandoffScopeV2Schema.shape.files.element.shape.edition,
        classification:
          LibraryHandoffScopeV2Schema.shape.files.element.shape.classification,
      }),
    })
    .parse(asset.properties).libraryAdoptionV2;
  const receipt = await tx.mediaHandoffReceipt.findUniqueOrThrow({
    where: { planId },
  });
  budget.consume(1);
  return loadMovieLibraryParentV2(
    tx,
    { receiptId: receipt.id, assetId: asset.id },
    budget,
  );
}
