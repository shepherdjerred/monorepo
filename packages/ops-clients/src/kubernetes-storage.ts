import { z } from "zod";

export const VeleroMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  creationTimestamp: z.iso.datetime({ offset: true }),
  annotations: z.record(z.string(), z.string()).default({}),
});

export const VeleroRestoreSchema = z.object({
  metadata: VeleroMetadataSchema,
  spec: z.object({ backupName: z.string().optional() }),
  status: z
    .object({
      phase: z
        .enum([
          "New",
          "InProgress",
          "WaitingForPluginOperations",
          "WaitingForPluginOperationsPartiallyFailed",
          "Finalizing",
          "FinalizingPartiallyFailed",
          "Completed",
          "PartiallyFailed",
          "Failed",
          "FailedValidation",
        ])
        .optional(),
      errors: z.number().int().nonnegative().optional(),
      completionTimestamp: z.iso.datetime({ offset: true }).optional(),
    })
    .optional(),
});

export type VeleroRestoreStatus = {
  name: string;
  namespace: string;
  backupName: string | undefined;
  createdAt: string;
  phase: NonNullable<z.infer<typeof VeleroRestoreSchema>["status"]>["phase"];
  errors: number;
  classification: VeleroRestoreFailureClassification;
  /** The accepted Restore named by a `superseded-by-accepted-restore` classification. */
  supersededBy: string | undefined;
};

export const VELERO_RESTORE_CLASSIFICATION_ANNOTATION =
  "ops.sjer.red/restore-failure-classification";
export const VELERO_RESTORE_SUPERSEDED_BY_ANNOTATION =
  "ops.sjer.red/superseded-by-restore";

const VeleroRestoreFailureClassificationSchema = z.enum([
  "unclassified",
  "expected-admission-block",
  "superseded-by-accepted-restore",
]);

export type VeleroRestoreFailureClassification = z.infer<
  typeof VeleroRestoreFailureClassificationSchema
>;

export const ZfsVolumeSchema = z.object({
  metadata: z.object({
    name: z.string(),
    deletionTimestamp: z.iso.datetime({ offset: true }).optional(),
  }),
  spec: z.object({ ownerNodeID: z.string(), poolName: z.string() }),
});

export type DeletingZfsVolume = {
  name: string;
  node: string;
  dataset: string;
  deletedAt: string;
};

export function toVeleroRestoreStatus({
  metadata,
  spec,
  status,
}: z.infer<typeof VeleroRestoreSchema>): VeleroRestoreStatus {
  const classification = VeleroRestoreFailureClassificationSchema.parse(
    metadata.annotations[VELERO_RESTORE_CLASSIFICATION_ANNOTATION] ??
      "unclassified",
  );
  const supersededBy =
    metadata.annotations[VELERO_RESTORE_SUPERSEDED_BY_ANNOTATION];
  // The supersession claim and the Restore it names are one contract; either
  // half without the other is an operator mistake, not a classification.
  if (
    supersededBy === "" ||
    (classification === "superseded-by-accepted-restore") !==
      (supersededBy !== undefined)
  ) {
    throw new Error(
      `Velero Restore ${metadata.namespace}/${metadata.name} must set ${VELERO_RESTORE_SUPERSEDED_BY_ANNOTATION} exactly when classified superseded-by-accepted-restore`,
    );
  }
  return {
    name: metadata.name,
    namespace: metadata.namespace,
    createdAt: metadata.creationTimestamp,
    backupName: spec.backupName,
    phase: status?.phase,
    errors: status?.errors ?? 0,
    classification,
    supersededBy,
  };
}
