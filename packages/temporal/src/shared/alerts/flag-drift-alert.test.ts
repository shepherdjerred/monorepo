import { describe, expect, test } from "vitest";
import {
  buildFlagDriftAlert,
  FLAG_DRIFT_ALERT_TTL_MS,
} from "#shared/alerts/flag-drift-alert.ts";

const NOW = new Date("2026-08-28T15:00:00.000Z");

describe("buildFlagDriftAlert", () => {
  test("fires one stable alert containing missing, extra, and drifted keys", () => {
    const alert = buildFlagDriftAlert(
      {
        deployment: "scout/beta",
        namespace: "scout",
        environment: "beta",
        missingFlags: ["declared-flag"],
        extraFlags: ["manual-flag"],
        contractMismatches: ["model: expected Luna, got Sol"],
      },
      NOW,
    );

    expect(alert.labels).toEqual({
      alertname: "FlagsManagedFlagDrift",
      severity: "warning",
      component: "feature-flags",
      deployment: "scout/beta",
      namespace: "scout",
      environment: "beta",
    });
    expect(alert.annotations["description"]).toContain(
      "Declared keys missing from Flags: declared-flag",
    );
    expect(alert.annotations["description"]).toContain(
      "Live keys absent from the inventory: manual-flag",
    );
    expect(alert.annotations["description"]).toContain(
      "Behavior contract mismatches: model: expected Luna, got Sol",
    );
    expect(alert.annotations["summary"]).toContain("scout/beta");
    expect(alert.endsAt).toBe(
      new Date(NOW.getTime() + FLAG_DRIFT_ALERT_TTL_MS).toISOString(),
    );
  });

  test("resolves with the exact same labels when aligned", () => {
    const firing = buildFlagDriftAlert(
      {
        deployment: "minecraft/tsmc",
        namespace: "the-storm",
        environment: "prod",
        missingFlags: ["declared-flag"],
        extraFlags: [],
        contractMismatches: [],
      },
      NOW,
    );
    const alert = buildFlagDriftAlert(
      {
        deployment: "minecraft/tsmc",
        namespace: "the-storm",
        environment: "prod",
        missingFlags: [],
        extraFlags: [],
        contractMismatches: [],
      },
      NOW,
    );

    expect(alert.labels).toEqual(firing.labels);
    expect(alert.endsAt).toBe(alert.startsAt);
    expect(alert.annotations["summary"]).toContain("aligned");
  });
});
