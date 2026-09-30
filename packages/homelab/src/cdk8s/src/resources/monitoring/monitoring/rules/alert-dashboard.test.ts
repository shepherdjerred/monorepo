import { describe, expect, it } from "vitest";
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
      'absent(up{namespace="alert-dashboard",service="alert-dashboard-alert-dashboard-service"})',
    );
    expect(alert.expr.value).not.toContain('service="alert-dashboard-service"');
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

  it("separates a stuck sender from a switched-off one", () => {
    const rules =
      getAlertDashboardRuleGroups().find(
        (candidate) => candidate.name === "alert-dashboard-health",
      )?.rules ?? [];
    const stuck = rules.find(
      (candidate) => candidate.alert === "AlertDashboardOutboxStuck",
    );
    const stranded = rules.find(
      (candidate) => candidate.alert === "AlertDashboardOutboxStranded",
    );
    if (stuck === undefined || stranded === undefined)
      throw new Error("expected both outbox rules");

    // Neither may fire in the other's state, or the pair is just one noisy
    // rule wearing two names.
    expect(stuck.expr.value).toContain("alert_dashboard_email_enabled == 1");
    expect(stranded.expr.value).toContain("alert_dashboard_email_enabled == 0");

    // A backlog nobody intends to send is not an outage.
    expect(stuck.labels?.["severity"]).toBe("critical");
    expect(stranded.labels?.["severity"]).toBe("warning");

    // Both diagnose the dashboard's own delivery path, so both need the
    // independent email route rather than the webhook they are reporting on.
    expect(stranded.labels?.["alert_dashboard_fallback"]).toBe("true");
  });
});
