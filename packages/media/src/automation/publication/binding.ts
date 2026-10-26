import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexPublicationParent } from "#shared/plex-binding/expected.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { capturePublicationPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import {
  assertPlexBindingExpected,
  preparePlexBindingLockScope,
} from "#infrastructure/plex-binding/authority.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { GenerationsSchema } from "#shared/file-plan.ts";
import { bindingAccess } from "#automation/plex-binding/access.ts";
import { verifyPlexAssociations } from "./association.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CompensationPublicationPort } from "./execution.ts";

export type PublicationBindingSource = {
  execution: PlexBindingExecution;
  budget: PublicationAuthorityReadBudget;
} & (
  | {
      parent: (
        tx: Prisma.TransactionClient,
        budget: PublicationAuthorityReadBudget,
      ) => Promise<PlexPublicationParent>;
      compensation?: never;
    }
  | { compensation: CompensationPublicationPort; parent?: never }
);

/** All configuration, canonical reads, and complete scans precede the final lock transaction. */
export async function preparePublicationBindingExpected(
  context: MediaAutomationContext,
  input: {
    mediaIds: string[];
    source: PublicationBindingSource;
    freshness: PlexBindingFreshness;
  },
) {
  const { source, freshness } = input;
  freshness.assertActive();
  const media = await context.db.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
    select: { kind: true },
  });
  freshness.assertActive();
  if (
    media.length !== input.mediaIds.length ||
    media.some((row) => row.kind !== "movie" && row.kind !== "episode")
  )
    throw new PlexBindingProtection("scope_changed");
  const access = await bindingAccess(
    context,
    media.map((row) => (row.kind === "movie" ? "movie" : "show")),
  );
  freshness.assertActive();
  const prepared = await context.db.$transaction(async (tx) => {
    const budget = source.budget;
    const compensationPhase = await source.compensation?.loadPhase(tx, budget);
    const parent =
      source.compensation === undefined
        ? await source.parent(tx, budget)
        : compensationPhase?.parent;
    if (parent === undefined)
      throw new Error(
        "Compensated publication capture requires its fresh transaction phase",
      );
    const expected = await capturePublicationPlexBindingExpected(
      tx,
      {
        mediaIds: input.mediaIds,
        parent,
        access,
      },
      budget,
      compensationPhase,
    );
    await assertPlexBindingExpected(tx, expected, freshness, {
      access,
      budget,
      compensationPhase,
    });
    const lockScope = await preparePlexBindingLockScope(tx, expected);
    const canonicalTargets = await readPlexCanonicalTargets(
      tx,
      expected.targets.map((target) => target.scope),
    );
    freshness.assertActive();
    return {
      expected,
      lockScope,
      canonicalTargets,
      freshness: compensationPhase?.freshness ?? freshness,
    };
  });
  freshness.assertActive();
  prepared.freshness.assertActive();
  return { ...prepared, source, access };
}

export async function verifyPublicationBinding(
  context: MediaAutomationContext,
  prepared: Awaited<ReturnType<typeof preparePublicationBindingExpected>>,
) {
  const { source, freshness, access } = prepared;
  freshness.assertActive();
  const verified = await verifyPlexAssociations(
    context,
    {
      purpose: "current_serving",
      expected: prepared.expected,
      canonicalTargets: prepared.canonicalTargets,
      access,
      observed: source.execution.observed,
      expiresAtMs: freshness.expiresAtMs,
      guards: [freshness],
    },
    source.execution,
  );
  freshness.assertActive();
  if ("status" in verified) throw new PlexBindingProtection(verified.reason);
  return { ...prepared, verified };
}

export function assertPublicationSelection(input: {
  selected: readonly { mediaId: string; assetId: string; ratingKey: string }[];
  sectionId: string;
  binding: Awaited<ReturnType<typeof verifyPublicationBinding>>;
}) {
  for (const item of input.selected) {
    const association = input.binding.verified.associations.find(
      (value) => value.scope.mediaId === item.mediaId,
    );
    if (
      association?.group.assetId !== item.assetId ||
      association.item.ratingKey !== item.ratingKey ||
      association.access.sectionId !== input.sectionId
    )
      throw new PlexBindingProtection("metadata_changed");
  }
}

/** Acquisition uses original raw JSON hashes, never a stripped parser projection. */
export async function acquisitionPublicationParent(
  tx: Prisma.TransactionClient,
  attemptId: string,
): Promise<PlexPublicationParent> {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  return {
    kind: "acquisition",
    attemptId: attempt.id,
    operationId: attempt.operationId,
    planHash: identityHash(attempt.filePlan),
    identityHash:
      attempt.identityEvidence === null
        ? null
        : identityHash(attempt.identityEvidence),
    recoveryEpoch: attempt.recoveryEpoch,
    generations: GenerationsSchema.parse(attempt.generations),
  };
}

export async function rollbackPublicationParent(
  tx: Prisma.TransactionClient,
  attemptId: string,
): Promise<PlexPublicationParent> {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  return {
    kind: "rollback",
    attemptId: attempt.id,
    operationId: attempt.operationId,
    planHash: identityHash(attempt.filePlan),
    failureHash: identityHash(attempt.failure),
    recoveryEpoch: attempt.recoveryEpoch,
  };
}
