import { z } from "zod";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { SeriesPackPublicationOutcomeV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";

/** Decode only: the calling reader must validate this literal outcome's actual parent. */
export function decodeOrdinaryPublicationOutcome(raw: unknown) {
  return z.object({ schemaVersion: z.literal(3) }).safeParse(raw).success
    ? SeriesPackPublicationOutcomeV3Schema.parse(raw)
    : PublicationOutcomeSchema.parse(raw);
}
