import { z } from "zod";
import { ObservedMountSchema } from "./legacy-observer.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const CanonicalMountSchema = ObservedMountSchema.extend({
  deployment: z.literal("media-media-files"),
  container: z.literal("media-files"),
  root: z.enum(["/data/movies", "/data/tv"]),
  readOnly: z.literal(false),
  podName: z.string().min(1),
  podUid: z.string().min(1),
  podSpecDigest: digest,
  replicaSetUid: z.string().min(1),
});
export const CanonicalMountEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("canonical_storage"),
    namespace: z.literal("media"),
    capturedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    configurationDigest: digest,
    mounts: z.array(CanonicalMountSchema).length(2),
  })
  .refine(
    (value) =>
      new Set(value.mounts.map((mount) => mount.root)).size === 2 &&
      new Set(value.mounts.map((mount) => mount.podUid)).size === 1,
    "Both roots must belong to the same unique executing files worker",
  );

export const ApprovedStorageRootSchema = z.strictObject({
  rootPath: z.enum(["/data/movies", "/data/tv"]),
  pvcUid: z.string().min(1),
  volumeName: z.string().min(1),
  volumePath: z.string().max(4096),
  receipt: z.strictObject({
    kind: z.enum(["legacy", "native"]),
    id: z.uuid(),
    planHash: digest,
  }),
});
export const ApprovedStorageRootsSchema = z
  .array(ApprovedStorageRootSchema)
  .length(2)
  .refine(
    (roots) => new Set(roots.map((root) => root.rootPath)).size === 2,
    "Both approved storage roots are required",
  );
export const NativeStorageAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("native_restore"),
  approvedRoots: ApprovedStorageRootsSchema,
  mounts: CanonicalMountEvidenceSchema,
});
export type ApprovedStorageRoot = z.infer<typeof ApprovedStorageRootSchema>;
export type CanonicalMountEvidence = z.infer<
  typeof CanonicalMountEvidenceSchema
>;
