import { z } from "zod";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const AbsolutePath = z
  .string()
  .startsWith("/")
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.includes("\0") &&
      value
        .slice(1)
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
  );

export const PlexSectionSnapshotSchema = z.object({
  serverMachineId: z.string().min(1),
  serverVersion: z.string().min(1),
  sectionId: z.string().regex(/^\d+$/u),
  sectionUuid: z.string().min(1),
  kind: z.enum(["movie", "episode"]),
  scanner: z.string().min(1),
  agent: z.string().min(1),
  locations: z.array(AbsolutePath).min(1).max(20),
  scannedAt: z.number().int().nonnegative(),
  refreshing: z.boolean(),
});
export type PlexSectionSnapshot = z.infer<typeof PlexSectionSnapshotSchema>;

export const PlexExclusionPlanSchema = z
  .object({
    procedureVersion: z.literal(1),
    cleanupPolicy: z.literal("owned-files-and-observed-metadata"),
    runId: z.uuid(),
    recoveryEpoch: z.number().int().nonnegative(),
    runtimeVersion: z.number().int().nonnegative(),
    topology: PlexSectionSnapshotSchema,
    libraryRoot: AbsolutePath,
    controlRoot: AbsolutePath,
    positivePath: AbsolutePath,
    negativePath: AbsolutePath,
    rootMarkerBefore: z
      .string()
      .max(64 * 1024)
      .nullable(),
    controlMarkerBefore: z
      .string()
      .max(64 * 1024)
      .nullable(),
    rootMarkerAfter: z.string().max(64 * 1024),
    controlMarkerAfter: z.string().max(64 * 1024),
    configurationDigest: Sha256,
  })
  .superRefine((value, ctx) => {
    if (
      value.controlRoot !== `${value.libraryRoot}/.media-control` ||
      !value.topology.locations.includes(value.libraryRoot) ||
      !value.positivePath.startsWith(
        `${value.libraryRoot}/Media Exclusion ${value.runId}`,
      ) ||
      !value.negativePath.startsWith(
        `${value.controlRoot}/probes/${value.runId}/`,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Probe paths must match the exact reviewed library and run",
      });
  });
export type PlexExclusionPlan = z.infer<typeof PlexExclusionPlanSchema>;

export const PlexPartInventorySchema = z.object({
  itemCount: z.number().int().nonnegative(),
  parts: z
    .array(
      z.object({
        ratingKey: z.string().regex(/^\d+$/u),
        partId: z.number().int().nonnegative(),
        path: AbsolutePath,
      }),
    )
    .max(200_000),
  digest: Sha256,
});
export type PlexPartInventory = z.infer<typeof PlexPartInventorySchema>;

export const PlexScanObservationSchema = z.object({
  topology: PlexSectionSnapshotSchema,
  inventory: PlexPartInventorySchema,
  observedAt: z.iso.datetime(),
  activeActivityIds: z.array(z.string().min(1)).max(10_000),
});
export type PlexScanObservation = z.infer<typeof PlexScanObservationSchema>;

export const PlexExclusionEvidenceSchema = z.object({
  procedureVersion: z.literal(1),
  planDigest: Sha256,
  probeSha256: Sha256,
  rootMarkerSha256: Sha256,
  controlMarkerSha256: Sha256,
  stagedAt: z.iso.datetime(),
  scanRequestedAt: z.iso.datetime(),
  activityId: z.string().min(1).nullable(),
  first: PlexScanObservationSchema,
  second: PlexScanObservationSchema,
});
export type PlexExclusionEvidence = z.infer<typeof PlexExclusionEvidenceSchema>;

export const PreparePlexExclusionSchema = z
  .object({
    kind: z.enum(["movies", "tv"]),
    expectedRuntimeVersion: z.number().int().nonnegative(),
  })
  .strict();
export const ExecutePlexExclusionSchema = z
  .object({
    planDigest: Sha256,
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type PlexExclusionOperation = { operationId: string; runId: string };
export type PlexExclusionNetworkActivities = {
  preparePlexExclusionTopology: (
    input: PlexExclusionOperation,
  ) => Promise<void>;
  validatePlexExclusionExecution: (
    input: PlexExclusionOperation,
  ) => Promise<void>;
  reconcilePlexExclusionScan: (
    input: PlexExclusionOperation & { cleanup: boolean },
  ) => Promise<{
    state: "waiting" | "verified" | "intervention";
    reason: string | null;
  }>;
  finishPlexExclusion: (input: PlexExclusionOperation) => Promise<void>;
  recordPlexExclusionIntervention: (
    input: PlexExclusionOperation,
  ) => Promise<void>;
};
export type PlexExclusionFileActivities = {
  preparePlexExclusionFiles: (input: PlexExclusionOperation) => Promise<void>;
  stagePlexExclusionFiles: (input: PlexExclusionOperation) => Promise<void>;
  cleanupPlexExclusionFiles: (input: PlexExclusionOperation) => Promise<void>;
};
