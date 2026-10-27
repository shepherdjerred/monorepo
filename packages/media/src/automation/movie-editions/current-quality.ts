import { z } from "zod";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { projectResolvedCatalog } from "#domain/resolved-evidence.ts";

/** Fresh catalog policy metadata reinterprets measured bytes without changing their literal owner evidence. */
export function movieCurrentQuality(
  properties: unknown,
  metadata: { runtimeMinutes: number | null; originalLanguage: string | null },
) {
  const attributes = PublicReleaseAttributesSchema.extend({
    id: z.string(),
    providerId: z.string(),
    title: z.string(),
  }).parse(properties);
  const original = attributes.resolvedEvidence;
  if (original === undefined) return attributes;
  return {
    ...attributes,
    resolvedEvidence: projectResolvedCatalog(original, metadata),
  };
}
