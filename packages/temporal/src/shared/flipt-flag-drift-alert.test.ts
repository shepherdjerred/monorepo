import { describe, expect, test } from "vitest";
import {
  buildFliptFlagDriftAlert,
  FLIPT_FLAG_DRIFT_ALERT_TTL_MS,
} from "#shared/flipt-flag-drift-alert.ts";

const NOW = new Date("2026-08-28T15:00:00.000Z");

describe("buildFliptFlagDriftAlert", () => {
  test("fires one stable alert containing both mismatch directions", () => {
    const alert = buildFliptFlagDriftAlert(
      {
        namespace: "default",
        environment: "default",
        missingInFlipt: ["declared-flag"],
        undeclaredInInventory: ["manual-flag"],
      },
      NOW,
    );

    expect(alert.labels).toEqual({
      alertname: "FliptManagedFlagDrift",
      severity: "warning",
      component: "feature-flags",
      namespace: "default",
      environment: "default",
    });
    expect(alert.annotations["description"]).toContain(
      "Declared keys missing from Flipt: declared-flag",
    );
    expect(alert.annotations["description"]).toContain(
      "Flipt keys absent from the inventory: manual-flag",
    );
    expect(alert.endsAt).toBe(
      new Date(NOW.getTime() + FLIPT_FLAG_DRIFT_ALERT_TTL_MS).toISOString(),
    );
  });

  test("resolves with the exact same labels when aligned", () => {
    const firing = buildFliptFlagDriftAlert(
      {
        namespace: "default",
        environment: "default",
        missingInFlipt: ["declared-flag"],
        undeclaredInInventory: [],
      },
      NOW,
    );
    const alert = buildFliptFlagDriftAlert(
      {
        namespace: "default",
        environment: "default",
        missingInFlipt: [],
        undeclaredInInventory: [],
      },
      NOW,
    );

    expect(alert.labels).toEqual(firing.labels);
    expect(alert.endsAt).toBe(alert.startsAt);
    expect(alert.annotations["summary"]).toContain("aligned");
  });
});
