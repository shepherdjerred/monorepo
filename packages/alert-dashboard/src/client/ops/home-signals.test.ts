import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import {
  SnapshotSchema,
  type Section,
  type Signal,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { describe, expect, it, test } from "vitest";

import {
  firingAlertSignals,
  firingAlertsHint,
  firingAlertsSeverity,
  waitingSeverity,
} from "./home-signals.ts";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import {
  volumeSnapshotResponse,
  type VolumeVariant,
} from "#test-fixtures/ops-snapshot-volume";

const NOW = "2026-08-08T12:00:00Z";

function fixtureAlerts(): { alerts: Section; alert: Signal } {
  const { snapshot } = fixtureOpsIngest(NOW);
  const alerts = findSection(SnapshotSchema.parse(snapshot), "alerts");
  const [alert] = alerts.signals;
  if (alert === undefined) throw new Error("fixture has no alert signal");
  return { alerts, alert };
}

test("the tile hint says how many groups the firing alerts are in", () => {
  expect(firingAlertsHint(1, "1")).toBe("in 1 group · 1 critical");
  expect(firingAlertsHint(4, "0")).toBe("in 4 groups · 0 critical");
  expect(firingAlertsHint(0, "—")).toBe("in 0 groups · — critical");
});

test("lists informational alerts and leaves out the silences summary", () => {
  const { alerts, alert } = fixtureAlerts();
  const section = {
    ...alerts,
    signals: [
      alert,
      { ...alert, id: "alerts:Watchdog:-", severity: "info" as const },
      { ...alert, id: "alerts:silences", kind: "silences" as const },
    ],
  };

  expect(firingAlertSignals(section).map((signal) => signal.id)).toEqual([
    alert.id,
    "alerts:Watchdog:-",
  ]);
});

describe("the firing-alerts tile severity", () => {
  it.each<[VolumeVariant, string]>([
    ["per-update", "ok"],
    ["aggregate", "error"],
  ])(
    "is error at production volume whether the count metric says so or not (%s)",
    (variant, metricSeverity) => {
      const alerts = findSection(
        volumeSnapshotResponse(NOW, variant),
        "alerts",
      );
      const metric = alerts.metrics.find(
        (entry) => entry.id === METRIC_IDS.alertsFiring,
      );
      if (metric === undefined) throw new Error("fixture has no firing metric");
      expect(metric.severity).toBe(metricSeverity);
      expect(firingAlertsSeverity(metric.severity, alerts)).toBe("error");
    },
  );

  it("is ok when nothing fires", () => {
    const { alerts } = fixtureAlerts();
    expect(firingAlertsSeverity("ok", { ...alerts, signals: [] })).toBe("ok");
  });

  it("takes the worst firing alert over a milder metric", () => {
    const { alerts, alert } = fixtureAlerts();
    const signals = [
      { ...alert, id: "a", severity: "info" as const },
      { ...alert, id: "b", severity: "warning" as const },
    ];
    expect(firingAlertsSeverity("ok", { ...alerts, signals })).toBe("warning");
  });

  it("keeps the metric's severity when it is the worse of the two", () => {
    const { alerts, alert } = fixtureAlerts();
    const signals = [{ ...alert, severity: "info" as const }];
    expect(firingAlertsSeverity("error", { ...alerts, signals })).toBe("error");
    // A count that could not be read is unknown, never green.
    expect(firingAlertsSeverity("unknown", { ...alerts, signals: [] })).toBe(
      "unknown",
    );
  });

  it("ignores the section's signals that are not alerts", () => {
    const { alerts, alert } = fixtureAlerts();
    const signals = [
      { ...alert, kind: "silences" as const, severity: "error" as const },
    ];
    expect(firingAlertsSeverity("ok", { ...alerts, signals })).toBe("ok");
  });
});

describe("the waiting-on-you tile severity", () => {
  it("is ok when nothing waits", () => {
    expect(waitingSeverity([])).toBe("ok");
  });

  it("stays informational however many informational signals wait", () => {
    const { alert } = fixtureAlerts();
    const approvals = Array.from({ length: 100 }, (_, index) => ({
      ...alert,
      id: `approval-${String(index)}`,
      severity: "info" as const,
      needsMe: true,
    }));
    expect(waitingSeverity(approvals)).toBe("info");
  });

  it("is the worst severity among what waits", () => {
    const { alert } = fixtureAlerts();
    expect(
      waitingSeverity([
        { ...alert, id: "a", severity: "info" as const },
        { ...alert, id: "b", severity: "warning" as const },
        { ...alert, id: "c", severity: "ok" as const },
      ]),
    ).toBe("warning");
  });
});
