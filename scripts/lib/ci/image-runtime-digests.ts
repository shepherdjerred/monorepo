import { createHash } from "node:crypto";
import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/u);
const IndexSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.enum([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ]),
  manifests: z
    .array(
      z.object({
        digest: DigestSchema,
        platform: z
          .object({ architecture: z.string(), os: z.string() })
          .optional(),
      }),
    )
    .min(1),
});
const ImageManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.enum([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ]),
  config: z.object({ digest: DigestSchema }),
  layers: z.array(z.object({ digest: DigestSchema })),
});

/** Verify raw registry bytes before accepting platform manifest digests. */
export function imageRuntimeDigests(
  raw: string,
  expectedDigest: string,
): string[] {
  const matches = (source: string) =>
    `sha256:${createHash("sha256").update(source).digest("hex")}` ===
    expectedDigest;
  if (!matches(raw) && !(raw.endsWith("\n") && matches(raw.slice(0, -1))))
    throw new Error(
      "Registry manifest bytes do not match the published digest",
    );
  const manifest: unknown = JSON.parse(raw);
  const index = IndexSchema.safeParse(manifest);
  if (index.success)
    return [
      ...new Set(
        index.data.manifests
          .filter(
            (entry) =>
              entry.platform?.architecture !== "unknown" &&
              entry.platform?.os !== "unknown",
          )
          .map((entry) => entry.digest),
      ),
    ];
  ImageManifestSchema.parse(manifest);
  return [];
}
