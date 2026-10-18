import { z } from "zod";
import {
  ArtifactInputSchema,
  ArtifactVersionSchema,
  IdentifierSchema,
} from "./artifact-contract.ts";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const Identity = z.string().min(1);
const Generation = z.number().int().nonnegative();
export const QualifiedForumBundleQuerySchema = z
  .object({
    xenforoVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    manifestDigest: Digest,
  })
  .strict();
export type QualifiedForumBundleQuery = z.infer<
  typeof QualifiedForumBundleQuerySchema
>;
export const PublishForumBundleSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: z.literal("storm-forum"),
    artifact: ArtifactInputSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const artifact = input.artifact;
    if (
      artifact.kind !== "archive" ||
      artifact.component !== "archive:forum-bundle" ||
      artifact.origin.kind !== "licensed-bundle" ||
      artifact.version !== artifact.origin.xenforoVersion ||
      artifact.uri !==
        `s3://storm-forum-releases/releases/${artifact.digest.slice(7)}.zip` ||
      Object.keys(artifact.requires).length > 0 ||
      artifact.runtimeDigests.length > 0
    )
      context.addIssue({
        code: "custom",
        message:
          "Forum acquisition requires its exact private content-addressed licensed archive and genuine producer identity",
      });
  });
export type PublishForumBundle = z.input<typeof PublishForumBundleSchema>;

export const ForumRuntimeStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: z.literal("installed"),
    xenforoVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    bundleSha256: Fingerprint,
    maintenance: z.literal(false),
    releaseLock: z.literal(false),
  })
  .strict();
export const ForumBaselineProofSchema = z
  .object({
    environmentId: z.enum(["storm-forum/beta", "storm-forum/prod"]),
    observedAt: z.iso.datetime(),
    application: z
      .object({
        name: z.enum(["storm-forum-beta", "storm-forum"]),
        uid: Identity,
        resourceVersion: Identity,
        sourceFingerprint: Fingerprint,
      })
      .strict(),
    runtimeImage: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/u),
    imageArtifactId: IdentifierSchema,
    bundleArtifactId: IdentifierSchema,
    bundleDigest: Digest,
    runtime: ForumRuntimeStatusSchema,
    storage: z
      .array(
        z
          .object({
            name: z.enum(["storm-forum-files", "storm-forum-database"]),
            uid: Identity,
            resourceVersion: Identity,
            volumeName: Identity,
            specFingerprint: Fingerprint,
          })
          .strict(),
      )
      .length(2)
      .refine(
        (claims) => new Set(claims.map((claim) => claim.name)).size === 2,
        "Both original claims must be observed",
      ),
    pods: z
      .array(
        z
          .object({
            name: Identity,
            uid: Identity,
            resourceVersion: Identity,
            imageId: Identity,
            workloadUid: Identity,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    releaseJob: z
      .object({
        name: Identity,
        uid: Identity,
        resourceVersion: Identity,
        specFingerprint: Fingerprint,
        completedAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export type ForumBaselineProof = z.infer<typeof ForumBaselineProofSchema>;
export const RequestForumBaselineSchema = z
  .object({
    requestId: IdentifierSchema,
    environmentId: z.enum(["storm-forum/beta", "storm-forum/prod"]),
    expectedEnvironmentGeneration: Generation,
    imageArtifactId: IdentifierSchema,
    bundleArtifactId: IdentifierSchema,
    reason: z.string().min(20).max(4000),
  })
  .strict();
export type RequestForumBaseline = z.infer<typeof RequestForumBaselineSchema>;
export const ForumBaselineIntentSchema = z.object({
  id: IdentifierSchema,
  environmentId: z.enum(["storm-forum/beta", "storm-forum/prod"]),
  imageArtifactId: IdentifierSchema,
  bundleArtifactId: IdentifierSchema,
  requestedBy: Identity,
  reason: z.string().min(20).max(4000),
  expectedEnvironmentGeneration: Generation,
  pipelineRevisionId: IdentifierSchema,
  configurationRevision: IdentifierSchema,
  snapshotFingerprint: Fingerprint,
  status: z.enum(["pending", "succeeded", "failed"]),
  workflowId: Identity,
  submittedAt: z.iso.datetime().nullable(),
  proof: ForumBaselineProofSchema.nullable(),
  message: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type ForumBaselineIntent = z.infer<typeof ForumBaselineIntentSchema>;
export const ForumBaselineSnapshotSchema = z
  .object({
    intentId: IdentifierSchema,
    image: ArtifactVersionSchema,
    bundle: ArtifactVersionSchema,
    proof: ForumBaselineProofSchema,
  })
  .strict();
export type ForumBaselineSnapshot = z.infer<typeof ForumBaselineSnapshotSchema>;
export const CompleteForumBaselineSchema = z
  .object({
    expectedEnvironmentGeneration: Generation,
    snapshotFingerprint: Fingerprint,
  })
  .strict();
export type CompleteForumBaseline = z.infer<typeof CompleteForumBaselineSchema>;
export const FailForumBaselineSchema = z
  .object({ message: z.string().min(1).max(4000) })
  .strict();
