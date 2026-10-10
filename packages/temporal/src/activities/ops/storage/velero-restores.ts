import type { VeleroRestoreStatus } from "@shepherdjerred/ops-clients/kubernetes-storage.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { logsLink } from "#activities/ops/ops-links.ts";

export function veleroRestoreSignals(
  restores: readonly VeleroRestoreStatus[],
): SignalInput[] {
  return restores
    .filter((restore) =>
      ["PartiallyFailed", "Failed", "FailedValidation"].includes(
        restore.phase ?? "",
      ),
    )
    .map((restore) => ({
      id: `maintenance:velero-restore:${restore.namespace}:${restore.name}`,
      source: "maintenance",
      section: "maintenance",
      kind: "backup-failure",
      severity:
        restore.classification === "expected-admission-block"
          ? "info"
          : "warning",
      needsMe: restore.classification !== "expected-admission-block",
      title: `Velero restore ${restore.name}: ${restore.phase ?? "unknown"}`,
      detail:
        restore.classification === "expected-admission-block"
          ? "Explicitly classified admission block; this attempt does not establish restore success."
          : "Persisted failed or partial restore requires investigation. A later successful backup does not clear this recovery failure.",
      since: restore.createdAt,
      attributes: {
        namespace: restore.namespace,
        restore: restore.name,
        backupName: restore.backupName ?? "",
        errors: restore.errors,
        classification: restore.classification,
      },
      links: [logsLink(restore.namespace)],
    }));
}
