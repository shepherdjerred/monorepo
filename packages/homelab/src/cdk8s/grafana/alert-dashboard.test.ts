import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createAlertDashboardGrafanaDashboard,
  exportAlertDashboardJson,
} from "./alert-dashboard.ts";

const DashboardSchema = z.object({
  panels: z.array(
    z
      .object({
        title: z.string(),
        datasource: z.object({
          type: z.literal("prometheus"),
          uid: z.string(),
        }),
        targets: z
          .array(z.object({ expr: z.string().optional() }).loose())
          .optional(),
      })
      .loose(),
  ),
});

describe("alert ledger Grafana dashboard", () => {
  it("uses the provisioned Prometheus datasource UID for every panel", () => {
    const dashboard = DashboardSchema.parse(
      createAlertDashboardGrafanaDashboard(),
    );

    expect(dashboard.panels).not.toHaveLength(0);
    for (const panel of dashboard.panels)
      expect(panel.datasource.uid).toBe("prometheus");
  });

  it("queries the synthesized Alert Dashboard ServiceMonitor identity", () => {
    const dashboard = DashboardSchema.parse(
      createAlertDashboardGrafanaDashboard(),
    );
    const servicePanel = dashboard.panels.find(
      (panel) => panel.title === "Service up",
    );
    if (servicePanel === undefined) throw new Error("Missing Service up panel");
    expect(servicePanel.targets?.[0]?.expr).toContain(
      'service="alert-dashboard-alert-dashboard-service"',
    );
  });

  it("exports a built dashboard with a title, not the builder instance", () => {
    // Guards the export path itself: exportAlertDashboardJson once serialized
    // the DashboardBuilder (missing .build()), producing a titleless JSON blob
    // Grafana rejected every 30s ("Dashboard title cannot be empty") while the
    // builder-based tests above stayed green. Helm escapes ({{ print "{{" }})
    // are reverted before parsing since they only become valid JSON post-Helm.
    const exported = exportAlertDashboardJson()
      .replaceAll('{{ print "{{" }}', "{{")
      .replaceAll('{{ print "}}" }}', "}}");
    const dashboard = z
      .object({
        title: z.string().min(1),
        panels: z.array(z.unknown()).nonempty(),
      })
      .loose()
      .parse(JSON.parse(exported));

    expect(dashboard.title).toBe("Alerts — Ledger Health");
  });
});
