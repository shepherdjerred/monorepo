import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { prepareEmbeddedContent } from "#automation/publication-proof/embedded.ts";
import {
  prepareSubtitleLineage,
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
  type PreparedSubtitleLineages,
} from "#automation/publication-proof/subtitle-lineage.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MoviePublicationIntentRefV2 } from "#shared/movie-editions/publication-v2.ts";
import type { MovieFilePlanV2 } from "#shared/movie-editions/file-plan-v2.ts";

/** All hashing/extraction and complete journal reads occur before the final PG transaction. */
export async function prepareMoviePublicationContentV2(
  context: PublicationContext,
  plan: MovieFilePlanV2,
  existing: MoviePublicationIntentRefV2 | null,
  budget: PublicationAuthorityReadBudget,
): Promise<PublicationContext> {
  const lineages: PreparedSubtitleLineages = new Map();
  const entry = plan.entries[0];
  if (existing === null && entry.previousAssetId !== null) {
    const asset = await snapshotMoviePublicationAssetV2(
      context.db,
      plan.scope,
      entry.previousAssetId,
      budget,
    );
    const grant = await findMoviePublicationReferenceV2(
      context.db,
      { scope: plan.scope, asset },
      budget,
    );
    if (grant?.subtitleLineage !== undefined)
      lineages.set(
        asset.id,
        await prepareSubtitleLineage(context, "movies", grant.subtitleLineage),
      );
  }
  const dependencies =
    existing === null
      ? undefined
      : recordedSubtitleDependencies(existing.intent);
  const prepared = await prepareContentProof(context, [
    ...publicationReferences(plan.entries),
    ...[...lineages.values()].flatMap((item) => item.references),
    ...(dependencies?.references ?? []),
  ]);
  const proof = prepared.contentProof;
  if (proof === undefined)
    throw new Error("Movie publication content proof missing");
  if (existing !== null)
    await assertRecordedSubtitleDependencies(context, proof, existing.intent);
  return {
    ...prepared,
    execution: context.execution,
    preparedEmbedded: await prepareEmbeddedContent(
      context,
      plan.entries,
      proof,
    ),
    preparedSubtitleLineages: lineages,
    ...(dependencies === undefined
      ? {}
      : { publicationDependencies: dependencies }),
  };
}
