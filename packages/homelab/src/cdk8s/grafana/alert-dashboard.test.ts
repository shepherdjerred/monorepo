import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { createAlertDashboardGrafanaDashboard } from "./alert-dashboard.ts";

const DashboardSchema = z.object({
  panels: z.array(
    z
      .object({
        datasource: z.object({
          type: z.literal("prometheus"),
          uid: z.string(),
        }),
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
});
