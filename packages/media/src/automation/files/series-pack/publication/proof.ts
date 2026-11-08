import type { FilePlanEntry } from "#automation/files/types.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { prepareEmbeddedContent } from "#automation/publication-proof/embedded.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import {
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
} from "#automation/publication-proof/subtitle-lineage.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { SeriesPackPublicationIntentRefV3 } from "#shared/acquisition/series-pack-publication-v1.ts";

/** Actual content is freshly verified; immutable parent JSON supplies no filesystem capability. */
export async function prepareSeriesPackPublicationProofV1(
  context: PublicationContext,
  plan: readonly FilePlanEntry[],
  parent: SeriesPackPublicationIntentRefV3,
) {
  const dependencies = recordedSubtitleDependencies(parent.intent);
  const prepared = await prepareContentProof(context, [
    ...publicationReferences(plan),
    ...dependencies.references,
  ]);
  const proof = prepared.contentProof;
  if (proof === undefined)
    throw new Error("Series pack publication content proof missing");
  await assertRecordedSubtitleDependencies(context, proof, parent.intent);
  return {
    ...prepared,
    execution: context.execution,
    publicationDependencies: dependencies,
    preparedEmbedded: await prepareEmbeddedContent(context, plan, proof),
  };
}
