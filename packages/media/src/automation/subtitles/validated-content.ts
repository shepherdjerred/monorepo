import { createHash } from "node:crypto";
import type { SubtitleSource } from "#domain/subtitle-maintenance/provider.ts";
import type { validateProviderSubtitle } from "./providers.ts";

/** Shared normalized bytes and their literal provider provenance, after validation. */
export function validatedSubtitleContent(
  source: SubtitleSource,
  validated: NonNullable<ReturnType<typeof validateProviderSubtitle>>,
) {
  return {
    forced: source.forced,
    hearingImpaired: source.hearingImpaired,
    checksum: createHash("sha256").update(validated.text).digest("hex"),
    content: new TextEncoder().encode(validated.text),
    provenance: {
      filename: source.filename,
      description: source.description,
      format: validated.format,
      simplifiedEvidence: validated.simplifiedEvidence,
      traditionalEvidence: validated.traditionalEvidence,
    },
  };
}
