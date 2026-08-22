import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAlertDashboardGrafanaDashboard } from "./alert-dashboard.ts";

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
      createAlertDashboardGrafanaDashboard().build(),
    );

    expect(dashboard.panels).not.toHaveLength(0);
    for (const panel of dashboard.panels)
      expect(panel.datasource.uid).toBe("prometheus");
  });

  it("queries the synthesized Alert Dashboard ServiceMonitor identity", () => {
    const dashboard = DashboardSchema.parse(
      createAlertDashboardGrafanaDashboard().build(),
    );
    const servicePanel = dashboard.panels.find(
      (panel) => panel.title === "Service up",
    );
    if (servicePanel === undefined) throw new Error("Missing Service up panel");
    expect(servicePanel.targets?.[0]?.expr).toContain(
      'service="alert-dashboard-alert-dashboard-service"',
    );
  });
});
