import { describe, expect, test } from "bun:test";
import { z } from "zod";
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
});
