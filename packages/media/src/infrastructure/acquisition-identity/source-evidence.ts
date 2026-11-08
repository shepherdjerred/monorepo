import { z } from "zod";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";

/** Preserve absent provider fields and the literal source-evidence schema. */
export function candidateSourceEvidence(
  source: Pick<
    ProviderCandidate,
    "infoHash" | "references" | "editionEvidence"
  >,
) {
  return z.record(z.string(), z.json()).parse(
    CandidateSourceEvidenceSchema.parse({
      infoHash: source.infoHash.toLowerCase(),
      ...(source.references === undefined
        ? {}
        : { references: source.references }),
      ...(source.editionEvidence === undefined
        ? {}
        : { editionEvidence: source.editionEvidence }),
    }),
  );
}
