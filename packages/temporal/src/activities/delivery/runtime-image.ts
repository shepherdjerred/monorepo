import { createHash } from "node:crypto";
import { z } from "zod";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { registryFetch } from "#activities/maintenance/deps-summary/deps-summary-oci.ts";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const DescriptorSchema = z.looseObject({
  mediaType: z.string(),
  digest: DigestSchema,
  size: z.number().int().positive(),
  platform: z
    .looseObject({ os: z.string(), architecture: z.string() })
    .optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});
const IndexSchema = z.looseObject({
  schemaVersion: z.literal(2),
  mediaType: z.literal("application/vnd.oci.image.index.v1+json"),
  manifests: z.array(DescriptorSchema).min(1),
});
const ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
  config: DescriptorSchema,
  layers: z.array(DescriptorSchema),
});
export type RuntimeManifestReader = (reference: string) => Promise<string>;

/** Same issued reader and scoped token exchange as dependency metadata inspection. */
export const readRuntimeManifest: RuntimeManifestReader = async (reference) => {
  const match =
    /^docker\.io\/(shepherdjerred\/[a-z0-9-]+)@(sha256:[a-f0-9]{64})$/u.exec(
      reference,
    );
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(
      "Runtime manifest reference is outside the supported registry",
    );
  const response = await registryFetch(
    `https://registry-1.docker.io/v2/${match[1]}/manifests/${match[2]}`,
    "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json",
  );
  if (!response.ok)
    throw new Error(
      `Runtime registry returned HTTP ${String(response.status)}`,
    );
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 1_048_576)
    throw new Error("Runtime manifest exceeds the metadata bound");
  return bytes;
};

function parseImmutable(bytes: string, digest: string): unknown {
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest)
    throw new Error("Runtime registry manifest content digest differs");
  const value: unknown = JSON.parse(bytes);
  return value;
}

function runnable(index: z.infer<typeof IndexSchema>) {
  const images = index.manifests.filter(
    (entry) =>
      entry.platform !== undefined &&
      entry.platform.os !== "unknown" &&
      entry.platform.architecture !== "unknown",
  );
  if (
    images.length === 0 ||
    new Set(images.map((entry) => entry.digest)).size !== images.length
  )
    throw new Error("Runtime index has missing or duplicate runnable images");
  for (const entry of index.manifests) {
    if (images.includes(entry)) continue;
    if (
      entry.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
      entry.platform?.os !== "unknown" ||
      entry.platform.architecture !== "unknown" ||
      entry.annotations?.["vnd.docker.reference.type"] !==
        "attestation-manifest" ||
      !images.some(
        (image) =>
          image.digest === entry.annotations?.["vnd.docker.reference.digest"],
      )
    )
      throw new Error(
        "Runtime index contains an unrecognized non-runnable descriptor",
      );
  }
  return images.sort((left, right) => left.digest.localeCompare(right.digest));
}

/** CRI may report another attestation index for the identical runnable image. */
export async function verifyRuntimeImageDigest(
  artifact: ArtifactVersion,
  imageID: string,
  configID: string | undefined,
  read: RuntimeManifestReader = readRuntimeManifest,
): Promise<void> {
  const observed = imageID.replace(/^docker-pullable:\/\//u, "");
  const reportedDigest = /sha256:[a-f0-9]{64}$/u.exec(observed)?.[0];
  if (
    observed.includes("@") &&
    observed !== `${artifact.uri}@${reportedDigest ?? ""}`
  )
    throw new Error("Runtime image ID has a foreign selected repository");
  if (
    reportedDigest !== undefined &&
    [artifact.digest, ...artifact.runtimeDigests].includes(reportedDigest)
  )
    return;
  const digest = observed.slice(`${artifact.uri}@`.length);
  if (
    !observed.startsWith(`${artifact.uri}@`) ||
    !DigestSchema.safeParse(digest).success ||
    !DigestSchema.safeParse(configID).success
  )
    throw new Error(
      "Runtime alias lacks its selected repository or running config identity",
    );
  const selected = IndexSchema.parse(
    parseImmutable(
      await read(`${artifact.uri}@${artifact.digest}`),
      artifact.digest,
    ),
  );
  const actual = IndexSchema.parse(
    parseImmutable(await read(observed), digest),
  );
  const approved = runnable(selected);
  const current = runnable(actual);
  const { manifests: _selectedManifests, ...selectedEnvelope } = selected;
  const { manifests: _actualManifests, ...actualEnvelope } = actual;
  if (
    canonicalJson(approved) !== canonicalJson(current) ||
    canonicalJson(selectedEnvelope) !== canonicalJson(actualEnvelope) ||
    canonicalJson(approved.map((entry) => entry.digest).sort()) !==
      canonicalJson([...artifact.runtimeDigests].sort())
  )
    throw new Error(
      "Runtime alias differs from the complete qualified runnable image set",
    );
  let matchesConfig = false;
  for (const entry of approved) {
    const bytes = await read(`${artifact.uri}@${entry.digest}`);
    const manifest = ManifestSchema.parse(parseImmutable(bytes, entry.digest));
    if (
      Buffer.byteLength(bytes) !== entry.size ||
      manifest.mediaType !== entry.mediaType
    )
      throw new Error(
        "Runtime child descriptor differs from its immutable manifest",
      );
    if (manifest.config.digest === configID) matchesConfig = true;
  }
  if (!matchesConfig)
    throw new Error(
      "Runtime config does not belong to a qualified runnable image",
    );
}
