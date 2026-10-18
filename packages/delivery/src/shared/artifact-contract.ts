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
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const origin = artifact.origin;
    if (
      origin.kind === "upstream" &&
      (artifact.kind !== "chart" ||
        origin.version !== artifact.version ||
        origin.checksum !== artifact.digest)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Upstream chart origin must identify the exact acquired version and bytes",
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
export const ArtifactVersionSchema = ArtifactInputSchema.safeExtend({
  serviceId: IdentifierSchema,
  buildId: IdentifierSchema,
  sourceRevision: Source,
  createdAt: z.iso.datetime(),
});
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
  sourceKind: z.enum(["ci", "upstream", "licensed-bundle"]).default("ci"),
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
    version: z.string().min(1).max(160),
    originKind: z
      .enum(["first-party", "upstream", "licensed-bundle"])
      .default("first-party"),
  })
  .strict();
export type FindQualifiedArtifact = z.infer<typeof FindQualifiedArtifactSchema>;
export const AcquireUpstreamArtifactSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: z.literal("minecraft"),
    sourceRevision: Source,
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
