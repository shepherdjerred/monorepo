import { describe, expect, test } from "vitest";
import {
  buildMainVulnScanAlert,
  MAIN_VULN_SCAN_ALERT_TTL_MS,
} from "./main-vuln-scan-alert.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

describe("buildMainVulnScanAlert", () => {
  test("fires with the TTL while critical findings exist", () => {
    const alert = buildMainVulnScanAlert(
      { criticalCount: 2, repoSha: REPO_SHA },
      NOW,
    );
    expect(alert.labels).toEqual({
      alertname: "MainVulnScanCritical",
      severity: "critical",
      component: "main-vuln-scan",
    });
    expect(alert.annotations["summary"]).toContain("2 CRITICAL finding(s)");
    expect(Date.parse(alert.endsAt) - Date.parse(alert.startsAt)).toBe(
      MAIN_VULN_SCAN_ALERT_TTL_MS,
    );
  });

  test("a clean run resolves under the identical label set", () => {
    const firing = buildMainVulnScanAlert(
      { criticalCount: 1, repoSha: REPO_SHA },
      NOW,
    );
    const resolved = buildMainVulnScanAlert(
      { criticalCount: 0, repoSha: REPO_SHA },
      NOW,
    );
    // Alertmanager identifies an alert by label set alone — the resolve must
    // carry exactly the firing labels or the earlier occurrence never closes.
    expect(resolved.labels).toEqual(firing.labels);
    expect(resolved.endsAt).toBe(resolved.startsAt);
    expect(resolved.annotations["summary"]).toContain("resolved");
  });

  test("the TTL outlives the weekly cadence so findings cannot self-expire", () => {
    expect(MAIN_VULN_SCAN_ALERT_TTL_MS).toBeGreaterThan(
      7 * 24 * 60 * 60 * 1000,
    );
  });
});
