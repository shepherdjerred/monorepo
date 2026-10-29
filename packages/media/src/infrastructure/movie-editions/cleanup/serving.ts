import { z } from "zod";
import type { Prisma, LibraryAsset } from "#generated/prisma/client.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import type {
  PlexAccess,
  PlexBindingSnapshot,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  readPlexDefinition,
  readPlexPhysicalGroup,
  readCurrentPlexBinding,
} from "#infrastructure/plex-binding/read.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import {
  MovieAttemptOperationV4Schema,
  MovieOperationV4Schema,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieRestorePlexExpectedV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";
import { readMovieRestorePlexReceiptV1 } from "#infrastructure/movie-editions/retention/restore-plex-receipt.ts";

export async function movieCleanupServing(
  tx: Prisma.TransactionClient,
  rawScope: z.infer<typeof MovieEditionScopeSchema>,
  access: readonly PlexAccess[],
  budget: PublicationAuthorityReadBudget,
) {
  const scope = MovieEditionScopeSchema.parse(rawScope);
  const selected = access[0];
  if (selected?.sectionType !== "movie" || access.length !== 1)
    throw new PlexBindingProtection("wrong_section");
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    take: 2,
  });
  const row = coverage[0];
  if (
    row === undefined ||
    coverage.length !== 1 ||
    target.editionRootId !== scope.rootMediaId ||
    target.availability !== "available"
  )
    throw new PlexBindingProtection("ownership_changed");
  const { asset, group } = await readPlexPhysicalGroup(tx, row.assetId);
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: scope.mediaId, edition: scope.edition },
      assetId: asset.id,
      access: selected,
    },
    budget,
  );
  if (binding.status !== "current" || binding.association.schemaVersion !== 2)
    throw new PlexBindingProtection("binding_changed");
  const completed = await movieCleanupReceipt(tx, binding.snapshot, budget);
  if (completed === null) throw new PlexBindingProtection("ownership_changed");
  const receipt = completed.receipt;
  assertMovieCleanupServing({
    completed,
    asset,
    group,
    binding: binding.snapshot,
    scope,
  });
  const canonicals = await readPlexCanonicalTargets(tx, [
    binding.snapshot.scope,
  ]);
  const canonical = canonicals[0];
  if (canonical?.kind !== "movie")
    throw new PlexBindingProtection("scope_changed");
  const pointer = await readPlexPointer(tx, binding.snapshot.scope, budget);
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  const body = {
    schemaVersion: completed.kind === "restored" ? 3 : 1,
    ...(completed.kind === "restored"
      ? { originalItem: completed.receipt.expected.originalItem }
      : {}),
    recoveryEpoch: asset.ownershipEpoch,
    access,
    targets: [
      {
        scope: binding.snapshot.scope,
        editionRootId: scope.rootMediaId,
        mediaVersion: media.version,
        intentVersion: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        definition: await readPlexDefinition(
          tx,
          binding.snapshot.scope,
          scope.rootMediaId,
        ),
        canonicalIdentityHash: canonical.canonicalIdentityHash,
        numberingHash: canonical.numberingHash,
      },
    ],
    previous: [pointer.expected],
    oldGroups: [group],
    newGroups: [group],
    parents: receipt.expected.parents,
  };
  const expected =
    completed.kind === "restored"
      ? MovieRestorePlexExpectedV1Schema.parse(body)
      : PlexBindingExpectedSchema.parse(body);
  return { target, group, binding: binding.snapshot, expected };
}

function assertMovieCleanupServing(input: {
  completed: NonNullable<Awaited<ReturnType<typeof movieCleanupReceipt>>>;
  asset: LibraryAsset;
  group: PlexPhysicalGroup;
  binding: PlexBindingSnapshot;
  scope: MovieEditionScope;
}) {
  const { completed, asset, group, binding, scope } = input;
  const receipt = completed.receipt;
  const publishedAt =
    completed.kind === "restored"
      ? completed.receipt.assetPlexPublishedAt
      : completed.receipt.publishedAt;
  if (
    identityHash(receipt.binding) !== identityHash(binding) ||
    identityHash(receipt.input.scope) !== identityHash(scope) ||
    identityHash(receipt.observation.associations[0].group) !==
      identityHash(group) ||
    asset.state !== "published" ||
    (asset.plexPublishedAt?.toISOString() ?? null) !== publishedAt
  )
    throw new PlexBindingProtection("ownership_changed");
}

async function movieCleanupReceipt(
  tx: Prisma.TransactionClient,
  binding: PlexBindingSnapshot,
  budget: PublicationAuthorityReadBudget,
) {
  const completions = await tx.operation.findMany({
    where: {
      OR: [
        "moviePlexReceiptV2",
        "moviePlexReceiptV3",
        "movieRestorePlexReceiptV1",
      ].map((key) => ({
        result: {
          path: [key, "receipt", "binding", "evidenceId"],
          equals: binding.evidenceId,
        },
      })),
    },
    take: 2,
  });
  budget.consume(completions.length);
  const command = completions[0];
  if (command === undefined || completions.length !== 1)
    throw new PlexBindingProtection("ownership_changed");
  if (command.kind === "restore_movie_edition_v4") {
    const raw = z
      .object({
        movieRestorePlexReceiptV1: z.object({
          receipt: z.object({ input: MovieOperationV4Schema }),
        }),
      })
      .parse(command.result);
    const receipt = await readMovieRestorePlexReceiptV1(
      tx,
      raw.movieRestorePlexReceiptV1.receipt.input,
      budget,
    );
    return receipt === null ? null : { kind: "restored" as const, receipt };
  }
  const raw = z
    .object({
      moviePlexReceiptV2: z
        .object({ receipt: z.object({ input: MovieAttemptOperationV4Schema }) })
        .optional(),
      moviePlexReceiptV3: z
        .object({ receipt: z.object({ input: MovieAttemptOperationV4Schema }) })
        .optional(),
    })
    .parse(command.result);
  const input =
    raw.moviePlexReceiptV2?.receipt.input ??
    raw.moviePlexReceiptV3?.receipt.input;
  if (input === undefined)
    throw new Error("Movie cleanup completion input missing");
  const receipt = await readMoviePlexReceiptV2(tx, input, budget);
  return receipt === null ? null : { kind: "acquisition" as const, receipt };
}
