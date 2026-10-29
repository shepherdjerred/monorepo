import { z } from "zod";
import {
  CutEvidenceSchema,
  CutReasonSchema,
  type CutConclusion,
} from "#shared/editions/evidence.ts";
import { MovieEditionKeySchema, type MovieEditionKey } from "./registry.ts";

/** New assessments only. Historical cut-markers-v1 evidence retains its literal format. */
export const MovieCutEvidenceV2Schema = CutEvidenceSchema.extend({
  schemaVersion: z.literal(2),
  parserVersion: z.literal("cut-markers-v2"),
});
export const MovieCutDecisionV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  edition: MovieEditionKeySchema,
  phase: z.enum(["candidate", "physical"]),
  accepted: z.boolean(),
  reasons: z.array(
    z.enum([
      ...CutReasonSchema.options,
      "edition_member_evidence_missing",
      "edition_canonical_mismatch",
    ]),
  ),
  candidate: MovieCutEvidenceV2Schema.shape.conclusion,
  current: z.array(MovieCutEvidenceV2Schema.shape.conclusion),
  members: z.array(MovieCutEvidenceV2Schema.shape.conclusion),
});
export type MovieCutEvidenceV2 = z.infer<typeof MovieCutEvidenceV2Schema>;
export type MovieCutDecisionV2 = z.infer<typeof MovieCutDecisionV2Schema>;

export function movieCutMatches(
  edition: MovieEditionKey,
  conclusion: CutConclusion,
): boolean {
  return edition === "default"
    ? conclusion.kind === "standard_unmarked"
    : conclusion.kind === "named" && conclusion.cut === edition;
}
