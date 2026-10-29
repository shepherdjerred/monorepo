import { z } from "zod";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";

export const CAPACITY_ROLES = ["movies", "tv"] as const;
export const CAPACITY_ROOTS = {
  movies: "/data/movies",
  tv: "/data/tv",
} as const;
export const CAPACITY_SAMPLE_MAX_AGE_MS = 300_000;
export const CAPACITY_INTERVAL_MS = 60_000;
export const CAPACITY_MOUNT_MAX_AGE_MS = 120_000;
export const CAPACITY_MAX_BYTES = 9_223_372_036_854_775_807n;
export const CapacityRoleSchema = z.enum(CAPACITY_ROLES);
export const CapacityDecimalSchema = z
  .string()
  .max(20)
  .regex(/^(?:0|[1-9]\d*)$/u);
const revision = CapacityDecimalSchema.refine(
  (value) => BigInt(value) > 0n && BigInt(value) <= CAPACITY_MAX_BYTES,
  "Expected a positive PostgreSQL bigint revision",
);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const CapacityBindingSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    role: CapacityRoleSchema,
    rootPath: z.enum(["/data/movies", "/data/tv"]),
    pvcUid: z.string().min(1).max(500),
    volumeName: z.string().min(1).max(500),
    volumePath: z.string().max(4096),
    workerPodUid: z.string().min(1).max(500),
    recoveryEpoch: z.int().nonnegative(),
  })
  .refine(
    (value) => value.rootPath === CAPACITY_ROOTS[value.role],
    "Role/root mismatch",
  );
export const CapacityCycleSchema = z.strictObject({
  recoveryEpoch: z.int().nonnegative(),
  cycles: z.tuple([
    z.strictObject({ role: z.literal("movies"), revision }),
    z.strictObject({ role: z.literal("tv"), revision }),
  ]),
});
export const CapacitySampleTokenSchema = z.strictObject({
  role: CapacityRoleSchema,
  recoveryEpoch: z.int().nonnegative(),
  cycleRevision: revision,
  sampleAttempt: revision,
  bindingDigest: digest,
});
export const CapacityMountReasonSchema = z.enum([
  "mount_observation_failed",
  "mount_proof_invalid",
]);
export const CapacitySampleReasonSchema = z.enum([
  "mount_missing",
  "mount_unavailable",
  "mount_expired",
  "mount_future",
  "worker_mismatch",
  "root_configuration_mismatch",
  "root_missing",
  "root_symlink",
  "root_not_directory",
  "root_changed",
  "statfs_failed",
  "capacity_invalid",
  "capacity_overflow",
]);
export const CapacityIdentitySchema = z.strictObject({
  device: CapacityDecimalSchema,
  inode: CapacityDecimalSchema,
});
export const CapacityMountResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("observed"),
    evidence: CanonicalMountEvidenceSchema,
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: CapacityMountReasonSchema,
  }),
]);
export const CapacitySampleResultSchema = z.discriminatedUnion("status", [
  z
    .strictObject({
      status: z.literal("observed"),
      observedAt: z.iso.datetime(),
      identity: CapacityIdentitySchema,
      totalBytes: z.bigint().positive().max(CAPACITY_MAX_BYTES),
      availableBytes: z.bigint().nonnegative().max(CAPACITY_MAX_BYTES),
    })
    .refine(
      (value) => value.availableBytes <= value.totalBytes,
      "Invalid available capacity",
    ),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: CapacitySampleReasonSchema,
  }),
]);
const sampleStartRole = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    token: CapacitySampleTokenSchema,
    binding: CapacityBindingSchema,
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    role: CapacityRoleSchema,
    reason: CapacitySampleReasonSchema,
  }),
]);
export const CapacitySampleStartSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("superseded") }),
  z.strictObject({
    status: z.literal("started"),
    roles: z
      .array(sampleStartRole)
      .length(2)
      .refine(
        (roles) =>
          roles.every(
            (value, index) =>
              (value.status === "ready" ? value.token.role : value.role) ===
              CAPACITY_ROLES[index],
          ),
        "Expected movies then tv",
      ),
  }),
]);
export const CapacityMountActivityResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("observed"),
      cycle: CapacityCycleSchema,
    }),
    z.strictObject({ status: z.literal("disabled") }),
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({ status: z.literal("superseded") }),
  ],
);
export const CapacitySampleActivityResultSchema = z
  .strictObject({
    status: z.enum(["disabled", "completed", "superseded"]),
    sampled: z.int().min(0).max(2),
    unavailable: z.int().min(0).max(2),
  })
  .refine(
    (value) =>
      value.sampled + value.unavailable <= 2 &&
      (value.status === "completed" || value.sampled + value.unavailable === 0),
    "Invalid sample counts",
  );
export type CapacityRole = z.infer<typeof CapacityRoleSchema>;
export type CapacityBinding = z.infer<typeof CapacityBindingSchema>;
export type CapacityCycle = z.infer<typeof CapacityCycleSchema>;
export type CapacitySampleToken = z.infer<typeof CapacitySampleTokenSchema>;
export type CapacityMountReason = z.infer<typeof CapacityMountReasonSchema>;
export type CapacitySampleReason = z.infer<typeof CapacitySampleReasonSchema>;
export type CapacityMountResult = z.infer<typeof CapacityMountResultSchema>;
export type CapacitySampleResult = z.infer<typeof CapacitySampleResultSchema>;
export type CapacitySampleStart = z.infer<typeof CapacitySampleStartSchema>;
export type CapacityMountActivityResult = z.infer<
  typeof CapacityMountActivityResultSchema
>;
export type CapacitySampleActivityResult = z.infer<
  typeof CapacitySampleActivityResultSchema
>;
export type CapacityActivities = {
  observeMediaCapacityMounts: () => Promise<CapacityMountActivityResult>;
  sampleMediaCapacity: (
    input: CapacityCycle,
  ) => Promise<CapacitySampleActivityResult>;
};
