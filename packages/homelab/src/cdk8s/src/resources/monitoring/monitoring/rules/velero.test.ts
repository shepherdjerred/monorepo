import { describe, expect, it } from "bun:test";
import {
  REVIEWED_LARGE_PVC_BACKUP_POLICY_MATCHERS,
  largePvcMayImpactBackupsExpr,
  getVeleroRuleGroups,
} from "./velero.ts";

describe("Velero large PVC backup policy alerts", () => {
  it("keeps reviewed large PVCs out of the may-impact-backups alert", () => {
    const groups = getVeleroRuleGroups();
    const sizeGroup = groups.find(
      (group) => group.name === "velero-backup-size",
    );
    if (sizeGroup === undefined) {
      throw new Error("expected velero-backup-size rule group");
    }
    if (sizeGroup.rules === undefined) {
      throw new Error("expected velero-backup-size rules");
    }

    const alert = sizeGroup.rules.find(
      (rule) => rule.alert === "VeleroLargePVCMayImpactBackups",
    );
    if (alert === undefined) {
      throw new Error("expected VeleroLargePVCMayImpactBackups alert");
    }

    const alertJson = JSON.stringify(alert);
    expect(alertJson).toContain("VeleroLargePVCMayImpactBackups");
    expect(alertJson).toContain(
      "kube_persistentvolumeclaim_resource_requests_storage_bytes > 200 * 1024 * 1024 * 1024",
    );
    expect(alertJson).toContain("unless on (namespace, persistentvolumeclaim)");
    expect(largePvcMayImpactBackupsExpr).toContain(
      "unless on (namespace, persistentvolumeclaim)",
    );
    for (const {
      namespace,
      persistentvolumeclaim,
    } of REVIEWED_LARGE_PVC_BACKUP_POLICY_MATCHERS) {
      expect(largePvcMayImpactBackupsExpr).toContain(
        `namespace="${namespace}"`,
      );
      expect(largePvcMayImpactBackupsExpr).toContain(
        `persistentvolumeclaim="${persistentvolumeclaim}"`,
      );
    }
  });
});
