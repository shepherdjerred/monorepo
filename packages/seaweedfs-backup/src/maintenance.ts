/** Aggregate progress only: never include source object keys or credentials. */
export type BackupMaintenanceProgress = {
  stage:
    | "snapshot-inventory"
    | "snapshot-prune"
    | "gc-protection"
    | "gc-history"
    | "gc-inventory"
    | "gc-sweep"
    | "gc-publish"
    | "gc-candidate-sets";
  completed: number;
  total?: number;
};

export type BackupMaintenanceHooks = {
  signal?: AbortSignal;
  onProgress?: (progress: BackupMaintenanceProgress) => void;
};

export function maintenanceCheckpoint(
  hooks: BackupMaintenanceHooks | undefined,
  progress: BackupMaintenanceProgress,
): void {
  hooks?.signal?.throwIfAborted();
  hooks?.onProgress?.(progress);
  // A progress callback can observe cancellation or stop the operation itself.
  hooks?.signal?.throwIfAborted();
}
