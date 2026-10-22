import { z } from "zod";

const sha256 = z.string().regex(/^[a-f\d]{64}$/u);
const fileSource = z.object({ source: z.url(), file: z.string(), sha256 });
const publisherSource = fileSource
  .extend({
    dependency: z.string().regex(/^[^/]+\/[^/]+$/u),
    packageSha512: z.string().min(1),
    nuspecSha256: sha256,
    licenseUrl: z.url(),
    sourceFile: z.string(),
    sourceSha256: sha256,
  })
  .strict();

export const NuGetLicenseProvenance = z.object({
  schemaVersion: z.literal(1),
  licenses: z.array(
    fileSource.extend({ repository: z.string(), commit: z.string() }),
  ),
  publisherLicenses: z
    .array(publisherSource)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => entry.dependency)).size ===
        entries.length,
      "Duplicate exact package publisher-license provenance.",
    ),
});

export function publisherLicenseFor(
  entries: z.infer<typeof publisherSource>[],
  dependency: string,
  metadata: {
    packageSha512: string;
    nuspecSha256: string;
    licenseUrl: string | undefined;
  },
): z.infer<typeof publisherSource> | undefined {
  const source = entries.find((entry) => entry.dependency === dependency);
  if (source === undefined) {
    const id = dependency.split("/", 1)[0];
    if (entries.some((entry) => entry.dependency.split("/", 1)[0] === id)) {
      throw new Error(
        `The exact publisher license package version changed: ${dependency}.`,
      );
    }
    return undefined;
  }
  if (
    source.packageSha512 !== metadata.packageSha512 ||
    source.nuspecSha256 !== metadata.nuspecSha256 ||
    source.licenseUrl !== metadata.licenseUrl
  ) {
    throw new Error(
      `The exact publisher license provenance changed: ${dependency}.`,
    );
  }
  return source;
}

export function verifiedLicenseText(
  source: z.infer<typeof fileSource>,
  bytes: Uint8Array,
  dependency: string,
): string {
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== source.sha256)
    throw new Error(`The pinned license asset changed: ${dependency}.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function verifiedPublisherLicenseText(
  source: z.infer<typeof publisherSource>,
  rawBytes: Uint8Array,
  textBytes: Uint8Array,
  dependency: string,
): string {
  const actual = new Bun.CryptoHasher("sha256").update(rawBytes).digest("hex");
  if (actual !== source.sourceSha256)
    throw new Error(
      `The captured publisher license source changed: ${dependency}.`,
    );
  return verifiedLicenseText(source, textBytes, dependency);
}
