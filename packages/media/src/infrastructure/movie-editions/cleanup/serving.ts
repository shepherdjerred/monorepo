import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import type {
  PlexAccess,
  PlexBindingSnapshot,
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
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";

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
  const binding = await readCurrentPlexBinding(tx, {
    scope: { mediaId: scope.mediaId, edition: scope.edition },
    assetId: asset.id,
    access: selected,
  });
  if (binding.status !== "current" || binding.association.schemaVersion !== 2)
    throw new PlexBindingProtection("binding_changed");
  const receipt = await movieCleanupReceipt(tx, binding.snapshot, budget);
  if (
    receipt === null ||
    identityHash(receipt.binding) !== identityHash(binding.snapshot) ||
    identityHash(receipt.input.scope) !== identityHash(scope) ||
    identityHash(receipt.observation.associations[0].group) !==
      identityHash(group) ||
    asset.state !== "published" ||
    asset.plexPublishedAt?.toISOString() !== receipt.publishedAt
  )
    throw new PlexBindingProtection("ownership_changed");
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
  const expected = PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
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
  });
  return { target, group, binding: binding.snapshot, expected };
}

async function movieCleanupReceipt(
  tx: Prisma.TransactionClient,
  binding: PlexBindingSnapshot,
  budget: PublicationAuthorityReadBudget,
) {
  const completions = await tx.operation.findMany({
    where: {
      OR: ["moviePlexReceiptV2", "moviePlexReceiptV3"].map((key) => ({
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
  return readMoviePlexReceiptV2(tx, input, budget);
}
