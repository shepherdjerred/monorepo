import { z } from "zod";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  ArtifactVersionSchema,
  IdentifierSchema,
} from "./artifact-contract.ts";

const Source = z.string().regex(/^[a-f0-9]{40}$/u);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const RunnerImage = z
  .string()
  .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/u);
export const RootReleasePipelineSchema = z
  .object({ kind: z.literal("root-release"), runnerImage: RunnerImage })
  .strict();
export const TofuPipelineSchema = z
  .object({
    kind: z.literal("tofu"),
    stack: TofuStackSchema,
    runnerImage: RunnerImage,
  })
  .strict();
export const PlatformSourceSchema = z
  .object({
    id: IdentifierSchema,
    sourceRevision: Source,
    repositoryId: z.number().int().positive(),
    pipelineNumber: z.number().int().positive(),
    ciUrl: z.url(),
  })
  .strict();
export const PlatformPrerequisiteSnapshotSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("root"),
      sourceBuildId: IdentifierSchema,
      rootArtifacts: z.record(IdentifierSchema, IdentifierSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tofu"),
      sourceBuildId: IdentifierSchema,
      stack: TofuStackSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("site"),
      environmentId: IdentifierSchema,
      artifactId: IdentifierSchema,
    })
    .strict(),
]);
export const SavedPlanFieldsSchema = z
  .object({
    sourceBuildId: IdentifierSchema,
    sourceRevision: Source,
    stack: TofuStackSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    planDigest: Digest,
    state: z
      .object({
        lineage: z.string().min(1).max(512),
        serial: z.number().int().nonnegative(),
      })
      .strict(),
    nativeJob: z
      .object({
        namespace: z.literal("delivery-platform-jobs"),
        name: z.string().regex(/^delivery-[a-f0-9]{40}$/u),
        uid: z.uuid(),
        specFingerprint: Hash,
        requestId: IdentifierSchema,
      })
      .strict(),
    changes: z
      .object({
        create: z.number().int().nonnegative(),
        update: z.number().int().nonnegative(),
        delete: z.number().int().nonnegative(),
        replace: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export function validSavedPlanWindow(plan: {
  createdAt: string;
  expiresAt: string;
}) {
  const lifetime = Date.parse(plan.expiresAt) - Date.parse(plan.createdAt);
  return lifetime > 0 && lifetime <= 24 * 60 * 60 * 1000;
}
export const TofuPlanReceiptSchema = SavedPlanFieldsSchema.extend({
  schema: z.literal("delivery-tofu-plan/v1"),
  deploymentId: IdentifierSchema,
}).refine(
  validSavedPlanWindow,
  "A saved plan expires within 24 hours of creation",
);
const base64Bytes = (size: number) =>
  z
    .base64()
    .refine(
      (value) => atob(value).length === size,
      `Expected ${String(size)} encoded bytes`,
    );
export const EncryptedTofuPlanSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    salt: base64Bytes(16),
    iv: base64Bytes(12),
    tag: base64Bytes(16),
    ciphertext: z
      .base64()
      .max(16 * 1024 * 1024)
      .refine(
        (value) => atob(value).length <= 8 * 1024 * 1024,
        "Saved plan plaintext is limited to 8 MiB",
      ),
  })
  .strict();
export const RecordTofuPlanSchema = z
  .object({
    receipt: TofuPlanReceiptSchema,
    encryptedPlan: EncryptedTofuPlanSchema,
  })
  .strict();
const SnapshotFields = {
  source: PlatformSourceSchema,
  prerequisites: z.array(PlatformPrerequisiteSnapshotSchema).max(120),
  policyFingerprint: Hash,
};
export const PlatformReleaseSnapshotSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("root-release"),
      ...SnapshotFields,
      siteArtifacts: z.record(IdentifierSchema, IdentifierSchema).default({}),
      charts: z
        .array(
          z
            .object({ name: IdentifierSchema, artifact: ArtifactVersionSchema })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tofu-plan"),
      ...SnapshotFields,
      stack: TofuStackSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tofu-apply"),
      ...SnapshotFields,
      stack: TofuStackSchema,
      planDeploymentId: IdentifierSchema,
      plan: TofuPlanReceiptSchema,
    })
    .strict(),
]);
const RequestFields = {
  requestId: IdentifierSchema,
  environmentId: IdentifierSchema,
  expectedGeneration: z.number().int().nonnegative(),
};
/** Root releases are retired (X6); their stored snapshots stay readable as history. */
export const CreatePlatformDeploymentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tofu-plan"),
      ...RequestFields,
      sourceBuildId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tofu-apply"),
      ...RequestFields,
      planDeploymentId: IdentifierSchema,
    })
    .strict(),
]);
export type PlatformReleaseSnapshot = z.infer<
  typeof PlatformReleaseSnapshotSchema
>;
export type CreatePlatformDeployment = z.infer<
  typeof CreatePlatformDeploymentSchema
>;
export type TofuPlanReceipt = z.infer<typeof TofuPlanReceiptSchema>;
export type RecordTofuPlan = z.infer<typeof RecordTofuPlanSchema>;
