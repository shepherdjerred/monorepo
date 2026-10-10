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
  classification: "unclassified" | "expected-admission-block";
};

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
  return {
    name: metadata.name,
    namespace: metadata.namespace,
    createdAt: metadata.creationTimestamp,
    backupName: spec.backupName,
    phase: status?.phase,
    errors: status?.errors ?? 0,
    classification: z
      .enum(["unclassified", "expected-admission-block"])
      .parse(
        metadata.annotations["ops.sjer.red/restore-failure-classification"] ??
          "unclassified",
      ),
  };
}
