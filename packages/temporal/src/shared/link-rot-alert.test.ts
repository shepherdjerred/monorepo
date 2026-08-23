import { describe, expect, test } from "vitest";
import { buildLinkRotAlert, LINK_ROT_ALERT_TTL_MS } from "./link-rot-alert.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

describe("buildLinkRotAlert", () => {
  test("fires with the TTL when critical findings exist", () => {
    const alert = buildLinkRotAlert(
      { criticalCount: 1, repoSha: REPO_SHA },
      NOW,
    );
    expect(alert.labels).toEqual({
      alertname: "LinkRotScanCritical",
      severity: "critical",
      component: "link-rot-scan",
    });
    expect(Date.parse(alert.endsAt) - Date.parse(alert.startsAt)).toBe(
      LINK_ROT_ALERT_TTL_MS,
    );
  });

  test("the ordinary warnings-only run resolves under the identical label set", () => {
    const firing = buildLinkRotAlert(
      { criticalCount: 1, repoSha: REPO_SHA },
      NOW,
    );
    const resolved = buildLinkRotAlert(
      { criticalCount: 0, repoSha: REPO_SHA },
      NOW,
    );
    // Alertmanager identifies an alert by label set alone — the resolve must
    // carry exactly the firing labels or an earlier occurrence never closes.
    expect(resolved.labels).toEqual(firing.labels);
    expect(resolved.endsAt).toBe(resolved.startsAt);
  });

  test("the TTL outlives the weekly cadence so findings cannot self-expire", () => {
    expect(LINK_ROT_ALERT_TTL_MS).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });
});
