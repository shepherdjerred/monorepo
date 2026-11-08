import { z } from "zod";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const EmbeddedStreamFactsV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  assetId: z.uuid(),
  videoChecksum: Hash,
  probeHash: Hash,
  streams: z
    .array(
      z.strictObject({
        subtitleId: z.uuid(),
        checksum: Hash,
        streamIndex: z.int().nonnegative(),
        language: z.enum(["en", "zh-Hans"]),
        forced: z.boolean().nullable(),
        hearingImpaired: z.boolean().nullable(),
      }),
    )
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.subtitleId)).size === rows.length,
      "Embedded stream identities must be distinct",
    )
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.streamIndex)).size === rows.length,
      "Embedded stream indices must be distinct",
    ),
});
export const EmbeddedStreamSourceV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  probeHash: Hash,
  streamIndex: z.int().nonnegative(),
});

/** Absence is literal historical unknown; malformed claimed v2 observations fail. */
export function embeddedStreamFacts(properties: unknown) {
  return z
    .object({ embeddedStreamFactsV2: EmbeddedStreamFactsV2Schema.optional() })
    .parse(properties).embeddedStreamFactsV2;
}
