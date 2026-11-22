import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AlertTable, partitionAlertsByGroup } from "./alert-table.tsx";
import {
  filterWatchdogAlerts,
  shouldShowWatchdog,
  watchdogToggleLabel,
} from "./dashboard-page.tsx";
import { AlertViewSchema, type AlertView } from "#shared/schema";

function makeAlert(
  index: number,
  overrides: Partial<{
    alertname: string;
    severity: "critical" | "warning" | "info" | "unknown";
    openedAt: string;
    summary: string;
  }> = {},
): AlertView {
  return AlertViewSchema.parse({
    id: `alert_${index.toString(16).padStart(32, "0")}`,
    fingerprint: `fp-${String(index)}`,
    alertname: overrides.alertname ?? `Alert${String(index)}`,
    namespace: "temporal",
    severity: overrides.severity ?? "warning",
    summary: overrides.summary ?? `Summary ${String(index)}`,
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: overrides.openedAt ?? "2026-08-08T18:00:00Z",
    resolvedAt: null,
    lastSeenAt: "2026-08-08T18:05:00Z",
    generatorUrl: null,
    labels: { alertname: overrides.alertname ?? `Alert${String(index)}` },
    annotations: {},
  });
}

function renderTable(alerts: readonly AlertView[]): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AlertTable, { alerts })),
  );
}

describe("Watchdog filtering", () => {
  it("hides Watchdog by default and surfaces count in toggle label", () => {
    const watchdog = makeAlert(1, {
      alertname: "Watchdog",
      severity: "unknown",
    });
    const disk = makeAlert(2, { alertname: "DiskFull", severity: "warning" });
    const params = new URLSearchParams();

    expect(shouldShowWatchdog(params)).toBe(false);
    const filtered = filterWatchdogAlerts([watchdog, disk], params);
    expect(filtered.watchdogCount).toBe(1);
    expect(filtered.showWatchdog).toBe(false);
    expect(filtered.visibleAlerts.map((item) => item.alertname)).toEqual([
      "DiskFull",
    ]);
    expect(watchdogToggleLabel(false, 1)).toBe("Show Watchdog (1)");
    expect(watchdogToggleLabel(false, 0)).toBe("Show Watchdog");
  });

  it("shows Watchdog when watchdog=1, q matches watchdog, or severity=unknown", () => {
    const watchdog = makeAlert(1, {
      alertname: "Watchdog",
      severity: "unknown",
    });

    for (const query of [
      "watchdog=1",
      "q=Watchdog",
      "q=watchdog",
      "severity=unknown",
    ]) {
      const params = new URLSearchParams(query);
      expect(shouldShowWatchdog(params)).toBe(true);
      const filtered = filterWatchdogAlerts([watchdog], params);
      expect(filtered.visibleAlerts).toHaveLength(1);
    }
    expect(watchdogToggleLabel(true, 2)).toBe("Hide Watchdog (2)");
  });
});

describe("AlertTable multi-occurrence grouping", () => {
  it("keeps single-occurrence alerts as direct table rows", () => {
    const html = renderTable([
      makeAlert(1, { alertname: "DiskFull" }),
      makeAlert(2, { alertname: "HighMemory" }),
    ]);

    expect(html).not.toContain("alert-group");
    expect(html).toContain("DiskFull");
    expect(html).toContain("HighMemory");
  });

  it("groups >=2 occurrences sharing alertname into details.alert-group with individual links", () => {
    const storm = Array.from({ length: 24 }, (_, index) =>
      makeAlert(index + 1, {
        alertname: "TemporalWorkflowFailed",
        severity: index === 5 ? "critical" : "warning",
        openedAt: index === 0 ? "2026-08-08T19:00:00Z" : "2026-08-08T18:00:00Z",
      }),
    );
    const single = makeAlert(99, { alertname: "DiskFull" });

    const partitioned = partitionAlertsByGroup([...storm, single]);
    expect(partitioned.groups).toHaveLength(1);
    expect(partitioned.groups[0]?.severity).toBe("critical");
    expect(partitioned.groups[0]?.newestOpenedAt).toBe("2026-08-08T19:00:00Z");
    expect(partitioned.singles).toHaveLength(1);

    const html = renderTable([...storm, single]);
    expect(html).toContain('<details class="alert-group');
    expect(html).toContain("TemporalWorkflowFailed");
    expect(html).toContain("24 occurrences");
    expect(html).toContain("severity-critical");
    expect(html).toContain(`/alerts/${storm[0]?.id ?? ""}`);
    expect(html).toContain(`/alerts/${storm[23]?.id ?? ""}`);
    expect(html).toContain(`/alerts/${single.id}`);
  });
});
