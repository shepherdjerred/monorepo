import { z } from "zod";
import {
  ProviderEditionEvidenceSchema,
  type ProviderEditionEvidence,
} from "#shared/acquisition/catalog.ts";
import type { TrackerProviderIdSchema } from "#shared/admin.ts";
import { IntegrationError } from "./http.ts";

/** Preserve each actual title field independently; title text is not structured cut metadata. */
export function releaseTitleEvidence(
  providerId: (typeof TrackerProviderIdSchema.options)[number],
  fields: readonly { field: string; text: string | null | undefined }[],
): ProviderEditionEvidence[] {
  const result = z
    .array(ProviderEditionEvidenceSchema)
    .max(20)
    .safeParse(
      fields.flatMap(({ field, text }) =>
        text === undefined || text === null || text.length === 0
          ? []
          : [{ text, provenance: { kind: "release-title", field } }],
      ),
    );
  if (!result.success)
    throw new IntegrationError(providerId, "invalid-response");
  return result.data;
}
