import { z } from "zod";

const name = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const path = z
  .string()
  .max(4096)
  .regex(/^\/[^\0\r\n]*$/u);
export const LegacyControllerSchema = z.strictObject({
  kind: z.literal("Deployment"),
  name,
  uid: z.string().min(1),
  generation: z.int().positive(),
  resourceVersion: z.string().min(1),
  specDigest: digest,
  observedGeneration: z.int().nonnegative(),
  desired: z.int().nonnegative(),
  current: z.int().nonnegative(),
  ready: z.int().nonnegative(),
});
export const QuiescenceEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  namespace: z.literal("media"),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  targetsDigest: digest,
  configurationDigest: digest,
  inventoryDigest: digest,
  controllers: z.array(LegacyControllerSchema).max(32),
  blockers: z
    .array(
      z.strictObject({
        code: z.string().min(1).max(100),
        kind: z.string().regex(/^[A-Za-z]+$/u),
        name,
      }),
    )
    .max(2000),
  quiescent: z.boolean(),
});
export type QuiescenceEvidence = z.infer<typeof QuiescenceEvidenceSchema>;

export const MountBindingRequestSchema = z.strictObject({
  sourceDeployment: name,
  sourceContainer: name,
  sourceRoot: path,
  canonicalDeployment: name,
  canonicalContainer: name,
  canonicalRoot: path,
});
export const ObservedMountSchema = z.strictObject({
  deployment: name,
  deploymentUid: z.string().min(1),
  generation: z.int().positive(),
  specDigest: digest,
  container: name,
  root: path,
  mountPath: path,
  subPath: z.string().max(4096),
  readOnly: z.boolean(),
  pvcName: name,
  pvcUid: z.string().min(1),
  volumeName: name,
  volumePath: z.string().max(4096),
  podName: name.optional(),
  podUid: z.string().min(1).optional(),
  podSpecDigest: digest.optional(),
  replicaSetUid: z.string().min(1).optional(),
});
export const MountEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  namespace: z.literal("media"),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  configurationDigest: digest,
  bindings: z
    .array(
      z.strictObject({
        source: ObservedMountSchema,
        canonical: ObservedMountSchema.extend({
          podName: name,
          podUid: z.string().min(1),
          podSpecDigest: digest,
          replicaSetUid: z.string().min(1),
        }),
        evidenceHash: digest,
      }),
    )
    .min(1)
    .max(100),
});
export type MountBindingRequest = z.infer<typeof MountBindingRequestSchema>;
export type MountEvidence = z.infer<typeof MountEvidenceSchema>;
