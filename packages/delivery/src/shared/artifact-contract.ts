import { z } from "zod";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][\w.:/-]*$/i);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Source = z.string().regex(/^[a-f0-9]{40}$/);
export const PlatformChangesSchema = z
  .object({
    root: z.boolean(),
    rootArtifacts: z.record(IdentifierSchema, IdentifierSchema),
    tofuStacks: z.array(TofuStackSchema).max(18),
    sites: z
      .array(
        z
          .object({
            environmentId: IdentifierSchema,
            artifactId: IdentifierSchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((changes, ctx) => {
    if (changes.root !== Object.keys(changes.rootArtifacts).length > 0)
      ctx.addIssue({
        code: "custom",
        message:
          "Root publication requires its exact original chart inventory, and non-root publication must omit it",
      });
    if (
      new Set(changes.tofuStacks).size !== changes.tofuStacks.length ||
      new Set(changes.sites.map((site) => site.environmentId)).size !==
        changes.sites.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Platform target and site identities must be unique",
      });
  });
const Https = z
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "HTTPS provenance repository required",
  );
export const ArtifactOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("first-party") }).strict(),
  z
    .object({
      kind: z.literal("upstream"),
      repository: Https,
      name: IdentifierSchema,
      version: z.string().min(1).max(160),
      checksum: Digest,
      /** A Git source's exact commit: the one its tag (`version`) named when acquired. */
      commit: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("licensed-bundle"),
      manifestDigest: Digest,
      xenforoVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      producerSourceRevision: Source,
    })
    .strict(),
]);
export type ArtifactOrigin = z.infer<typeof ArtifactOriginSchema>;
/**
 * Where an acquired Git source's commit tarball lives: content-addressed in
 * the Delivery artifact bucket, so its bytes never change under the digest.
 */
export function sourceArchiveUri(name: string, digest: string): string {
  return `s3://delivery-artifacts/sources/${name}/${digest.slice("sha256:".length)}.tar.gz`;
}
type UpstreamOrigin = Extract<ArtifactOrigin, { kind: "upstream" }>;
/**
 * An upstream origin names the exact acquired bytes: a chart or image by
 * its version and checksum, a Git source by its tag, the commit the tag
 * named (the artifact's version) and the stored tarball's checksum.
 */
function upstreamIdentity(
  artifact: { kind: string; version: string; digest: string; uri: string },
  origin: UpstreamOrigin,
) {
  if (origin.checksum !== artifact.digest) return false;
  return artifact.kind === "archive"
    ? origin.commit === artifact.version &&
        artifact.uri === sourceArchiveUri(origin.name, artifact.digest)
    : (artifact.kind === "chart" || artifact.kind === "image") &&
        origin.commit === undefined &&
        origin.version === artifact.version;
}
export const ArtifactInputSchema = z
  .object({
    id: IdentifierSchema,
    component: IdentifierSchema,
    kind: z.enum(["image", "chart", "archive"]),
    uri: z.string().min(1).max(2048),
    digest: Digest,
    runtimeDigests: z.array(Digest).max(32).default([]),
    requires: z.record(IdentifierSchema, Digest).default({}),
    version: z.string().min(1).max(160),
    origin: ArtifactOriginSchema.default({ kind: "first-party" }),
    /**
     * Content identity with the version string excluded (X10). Charts carry
     * the producer's `fingerprintChart` so an unchanged chart is retained
     * instead of republished under a new version.
     */
    contentFingerprint: Digest.optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const origin = artifact.origin;
    if (origin.kind === "upstream" && !upstreamIdentity(artifact, origin))
      ctx.addIssue({
        code: "custom",
        message:
          "Upstream origin must identify the exact acquired chart or image version, or source commit, and bytes",
      });
    if (artifact.contentFingerprint !== undefined && artifact.kind !== "chart")
      ctx.addIssue({
        code: "custom",
        message:
          "Content fingerprints identify chart bytes with the version excluded",
      });
    if (
      origin.kind === "licensed-bundle" &&
      (artifact.kind !== "archive" ||
        !/^s3:\/\/storm-forum-releases\/releases\/[a-f0-9]{64}\.zip$/.test(
          artifact.uri,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Licensed bundle origin requires its private content-addressed archive",
      });
  });
/**
 * Section 7: the v1 artifact a carried artifact stands for. Its bytes,
 * digest, URI and original build are that artifact's; only the component
 * name and owning service follow the catalog.
 */
export const MigratedFromSchema = z.strictObject({
  artifactId: IdentifierSchema,
  serviceId: IdentifierSchema,
  component: IdentifierSchema,
  buildId: IdentifierSchema,
});
export type MigratedFrom = z.infer<typeof MigratedFromSchema>;
export const ArtifactVersionSchema = ArtifactInputSchema.safeExtend({
  serviceId: IdentifierSchema,
  buildId: IdentifierSchema,
  sourceRevision: Source,
  createdAt: z.iso.datetime(),
  migratedFrom: MigratedFromSchema.optional(),
});
export const BuildSourceKindSchema = z.enum([
  "ci",
  "upstream",
  "licensed-bundle",
  "attested",
  /** Section 7: v1 artifacts carried onto the catalog's names and owners. */
  "migrated",
]);
export type BuildSourceKind = z.infer<typeof BuildSourceKindSchema>;
/** How a build entered Delivery, as operators read it on a pipeline. */
export function buildSourceLabel(sourceKind: string): string {
  switch (BuildSourceKindSchema.parse(sourceKind)) {
    case "ci": {
      return "main";
    }
    case "upstream": {
      return "Upstream acquisition";
    }
    case "licensed-bundle": {
      return "Licensed bundle";
    }
    case "attested": {
      return "Operator attestation";
    }
    case "migrated": {
      return "Catalog migration";
    }
  }
}
export const PublishBuildSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: IdentifierSchema,
    sourceRevision: Source,
    ciUrl: z.url(),
    verifiedAt: z.iso.datetime(),
    artifacts: z.array(ArtifactInputSchema).max(100),
    retainedArtifactIds: z.array(IdentifierSchema).max(100).default([]),
    platformChanges: PlatformChangesSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.artifacts.length + input.retainedArtifactIds.length > 0,
    "Publication requires new or original retained artifacts",
  );
export const BuildSummarySchema = z.object({
  id: IdentifierSchema,
  serviceId: IdentifierSchema,
  sourceRevision: Source,
  sourceKind: BuildSourceKindSchema.default("ci"),
  ciUrl: z.url().nullable(),
  status: z.enum(["pending", "verified", "failed"]),
  qualificationReason: z.string().nullable(),
  platformChanges: PlatformChangesSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
});
export const FindQualifiedArtifactSchema = z
  .object({
    serviceId: IdentifierSchema,
    component: IdentifierSchema,
    kind: ArtifactInputSchema.shape.kind,
    digest: Digest,
    /** Omitted: match the bytes regardless of the producer's version string. */
    version: z.string().min(1).max(160).optional(),
    originKind: z
      .enum(["first-party", "upstream", "licensed-bundle"])
      .default("first-party"),
  })
  .strict();
export type FindQualifiedArtifact = z.infer<typeof FindQualifiedArtifactSchema>;
const ComponentQuery = {
  serviceId: IdentifierSchema,
  component: IdentifierSchema,
  kind: ArtifactInputSchema.shape.kind,
};
export const LatestQualifiedArtifactQuerySchema = z
  .object(ComponentQuery)
  .strict();
export type LatestQualifiedArtifactQuery = z.infer<
  typeof LatestQualifiedArtifactQuerySchema
>;
/**
 * A producer's comparison base (B2): `beforePipeline` is the producer's own
 * main pipeline, so the base never comes from it or a later pipeline (B4).
 */
export const LatestRetainableArtifactQuerySchema = z
  .object({
    ...ComponentQuery,
    beforePipeline: z.coerce.number().int().positive().max(2_147_483_647),
  })
  .strict();
export type LatestRetainableArtifactQuery = z.infer<
  typeof LatestRetainableArtifactQuerySchema
>;
export const AcquireUpstreamArtifactSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: IdentifierSchema,
    sourceRevision: Source,
    /**
     * The main pipeline that performed the acquisition (B3); its order key
     * (B4). Absent only from producers older than this field.
     */
    pipeline: z
      .object({
        repositoryId: z.number().int().positive(),
        pipelineNumber: z.number().int().positive(),
      })
      .strict()
      .optional(),
    artifact: ArtifactInputSchema,
  })
  .strict()
  .refine(
    (input) => input.artifact.origin.kind === "upstream",
    "Upstream acquisition requires explicit original origin",
  );
export type AcquireUpstreamArtifact = z.input<
  typeof AcquireUpstreamArtifactSchema
>;
export const ArtifactAcquisitionSchema = z.object({
  buildId: IdentifierSchema,
  artifact: ArtifactVersionSchema,
  status: z.enum(["pending", "verified", "failed"]),
});
