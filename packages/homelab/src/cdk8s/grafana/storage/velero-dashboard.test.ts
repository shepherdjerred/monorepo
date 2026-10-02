import { describe, expect, test } from "vitest";
import { z } from "zod";
import { CI_KUBE_STATE_METRICS_VALUES } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/grafana-values.ts";
import { createVeleroDashboard } from "./velero-dashboard.ts";

const DashboardSchema = z.object({
  panels: z.array(
    z
      .object({
        title: z.string(),
        targets: z
          .array(z.object({ expr: z.string().optional() }).loose())
          .optional(),
      })
      .loose(),
  ),
});

describe("Velero dashboard", () => {
  test("shows event counts without synthesizing healthy status on missing telemetry", () => {
    const dashboard = DashboardSchema.parse(createVeleroDashboard());
    const failures = dashboard.panels.find(
      (panel) => panel.title === "Recorded Failures (24h)",
    );
    expect(failures?.targets?.[0]?.expr).toBe(
      'sum(increase(velero_backup_failure_total{schedule!=""}[24h]))',
    );
    expect(
      dashboard.panels.some((panel) => panel.title === "Current Backup Status"),
    ).toBe(false);
    expect(
      dashboard.panels.find((panel) => panel.title === "Completed Backups (1h)")
        ?.targets?.[0]?.expr,
    ).not.toContain("bool");
    expect(
      dashboard.panels.find(
        (panel) => panel.title === "Backup Deletion Success Rate",
      )?.targets?.[0]?.expr,
    ).toContain(" > 0");
  });
  test("sizes only PVCs explicitly enabled for backup", () => {
    const dashboard = DashboardSchema.parse(createVeleroDashboard());
    const storagePanels = dashboard.panels.filter((panel) =>
      panel.title.includes("Backup-Enabled"),
    );

    expect(storagePanels).toHaveLength(5);
    for (const panel of storagePanels) {
      const expression = panel.targets?.[0]?.expr;
      expect(expression).toContain("kube_persistentvolumeclaim_labels");
      expect(expression).toContain('label_velero_io_backup="enabled"');
      expect(expression).toContain(
        "on(namespace, persistentvolumeclaim) group_left()",
      );
    }
  });

  test("scopes both join sides to the selected namespace", () => {
    const dashboard = DashboardSchema.parse(createVeleroDashboard());
    const storagePanels = dashboard.panels.filter((panel) =>
      panel.title.includes("Backup-Enabled"),
    );

    for (const panel of storagePanels) {
      const expression = panel.targets?.[0]?.expr;
      expect(expression).toContain(
        'kube_persistentvolumeclaim_labels{namespace=~"$namespace",label_velero_io_backup="enabled"}',
      );
    }
  });

  // The dashboard can only join on a PVC label that kube-state-metrics is
  // configured to export; a dropped allowlist entry silently empties the panels.
  test("joins on a PVC label kube-state-metrics actually exports", () => {
    expect(CI_KUBE_STATE_METRICS_VALUES.metricLabelsAllowlist).toContain(
      "persistentvolumeclaims=[velero.io/backup]",
    );
  });
});
