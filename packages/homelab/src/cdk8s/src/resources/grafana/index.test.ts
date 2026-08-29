import { describe, expect, test } from "vitest";
import { z } from "zod";

import { ALL_DASHBOARDS } from "./index.ts";

// A dashboard that was exported without .build() serializes the
// DashboardBuilder's internal state ({ currentY, currentX, internal: … })
// instead of a dashboard, which Grafana's file provisioner rejects with
// "Dashboard title cannot be empty" — silently, every 30 seconds.
const BuiltDashboardSchema = z
  .object({
    title: z.string().min(1),
    uid: z.string().min(1),
    panels: z.array(z.unknown()).min(1),
  })
  .loose();

// Inverse of exportDashboardWithHelmEscaping's {{var}} escaping, so the
// exported ConfigMap payload round-trips back to parseable JSON.
function unescapeHelmTemplate(exported: string): string {
  return exported
    .replaceAll('{{ print "{{" }}', "{{")
    .replaceAll('{{ print "}}" }}', "}}");
}

describe("provisioned Grafana dashboard exports", () => {
  test.each(ALL_DASHBOARDS)(
    "$jsonFilename exports a built dashboard with a top-level title and uid",
    (config) => {
      const parsed: unknown = JSON.parse(
        unescapeHelmTemplate(config.exportFn()),
      );
      const dashboard = BuiltDashboardSchema.parse(parsed);
      expect(dashboard.title).not.toBe("");
    },
  );
});
