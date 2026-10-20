import type { VeleroRestoreStatus } from "@shepherdjerred/ops-clients/kubernetes-storage.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { logsLink } from "#activities/ops/ops-links.ts";

const FAILED_RESTORE_PHASES = new Set([
  "PartiallyFailed",
  "Failed",
  "FailedValidation",
]);

type RestoreAssessment =
  { accepted: true; detail: string } | { accepted: false; detail: string };

function supersessionRejection(
  restore: VeleroRestoreStatus,
  name: string,
  successor: VeleroRestoreStatus | undefined,
): string | undefined {
  if (successor === undefined) {
    return `the named Restore ${name} does not exist`;
  }
  if (successor.phase !== "Completed") {
    return `the named Restore ${name} is ${successor.phase ?? "without a phase"}, not Completed`;
  }
  // Schedule-based Restores may omit backupName; two absent names are not
  // evidence that both restored the same Backup.
  if (
    restore.backupName === undefined ||
    restore.backupName === "" ||
    successor.backupName === undefined ||
    successor.backupName === ""
  ) {
    return `this Restore or the named Restore ${name} records no Backup name, so the same Backup cannot be confirmed`;
  }
  if (successor.backupName !== restore.backupName) {
    return `the named Restore ${name} restored a different Backup`;
  }
  return Date.parse(successor.createdAt) <= Date.parse(restore.createdAt)
    ? `the named Restore ${name} is not later than this attempt`
    : undefined;
}

/**
 * A failed Restore is downgraded only when the Restore it names is present,
 * Completed, later, and restored the same Backup. Anything else stays a
 * warning that says why the supersession was not accepted.
 */
function assessSupersession(
  restore: VeleroRestoreStatus,
  restores: readonly VeleroRestoreStatus[],
): RestoreAssessment {
  const name = restore.supersededBy;
  if (name === undefined) {
    throw new Error(
      `Velero Restore ${restore.namespace}/${restore.name} is classified superseded without naming a Restore`,
    );
  }
  const successor = restores.find(
    (candidate) =>
      candidate.namespace === restore.namespace && candidate.name === name,
  );
  const rejection = supersessionRejection(restore, name, successor);
  return rejection === undefined
    ? {
        accepted: true,
        detail: `Superseded by the later Completed Restore ${name} of the same Backup.`,
      }
    : {
        accepted: false,
        detail: `Classified as superseded, but ${rejection}. This failed or partial restore still requires investigation.`,
      };
}

function assessRestore(
  restore: VeleroRestoreStatus,
  restores: readonly VeleroRestoreStatus[],
): RestoreAssessment {
  switch (restore.classification) {
    case "expected-admission-block":
      return {
        accepted: true,
        detail:
          "Explicitly classified admission block; this attempt does not establish restore success.",
      };
    case "superseded-by-accepted-restore":
      return assessSupersession(restore, restores);
    case "unclassified":
      return {
        accepted: false,
        detail:
          "Persisted failed or partial restore requires investigation. A later successful backup does not clear this recovery failure.",
      };
  }
}

export function veleroRestoreSignals(
  restores: readonly VeleroRestoreStatus[],
): SignalInput[] {
  return restores
    .filter((restore) => FAILED_RESTORE_PHASES.has(restore.phase ?? ""))
    .map((restore): SignalInput => {
      const assessment = assessRestore(restore, restores);
      return {
        id: `maintenance:velero-restore:${restore.namespace}:${restore.name}`,
        source: "maintenance",
        section: "maintenance",
        kind: "backup-failure",
        severity: assessment.accepted ? "info" : "warning",
        needsMe: !assessment.accepted,
        title: `Velero restore ${restore.name}: ${restore.phase ?? "unknown"}`,
        detail: assessment.detail,
        since: restore.createdAt,
        attributes: {
          namespace: restore.namespace,
          restore: restore.name,
          backupName: restore.backupName ?? "",
          errors: restore.errors,
          classification: restore.classification,
          supersededBy: restore.supersededBy ?? "",
        },
        links: [logsLink(restore.namespace)],
      };
    });
}
