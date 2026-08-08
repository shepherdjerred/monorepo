import { describe, expect, it } from "bun:test";
import { getAlertDashboardRuleGroups } from "./alert-dashboard.ts";

describe("AlertDashboardDown", () => {
  it("fires when the scrape is down or the target is absent", () => {
    const group = getAlertDashboardRuleGroups().find(
      (candidate) => candidate.name === "alert-dashboard-health",
    );
    const alert = group?.rules?.find(
      (candidate) => candidate.alert === "AlertDashboardDown",
    );
    if (alert === undefined)
      throw new Error("expected AlertDashboardDown rule");

    expect(alert.expr.value).toContain(" == 0");
    expect(alert.expr.value).toContain(
      'absent(up{namespace="alert-dashboard",service="alert-dashboard-service"})',
    );
  });

  it("alerts on the oldest pending email age rather than queue occupancy", () => {
    const group = getAlertDashboardRuleGroups().find(
      (candidate) => candidate.name === "alert-dashboard-health",
    );
    const alert = group?.rules?.find(
      (candidate) => candidate.alert === "AlertDashboardOutboxStuck",
    );
    if (alert === undefined)
      throw new Error("expected AlertDashboardOutboxStuck rule");

    expect(alert.expr.value).toContain(
      "time() - alert_dashboard_oldest_pending_email_timestamp_seconds > 3600",
    );
    expect(alert.expr.value).not.toContain(
      "alert_dashboard_email_outbox_depth",
    );
    expect(alert.for).toBe("5m");
  });
});
