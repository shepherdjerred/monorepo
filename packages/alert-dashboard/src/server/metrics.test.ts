import { describe, expect, it } from "bun:test";

import { Metrics } from "#server/metrics";

describe("Prometheus metrics", () => {
  it("keeps labelled results separate and supports counted worker batches", () => {
    const metrics = new Metrics();
    metrics.increment("alert_dashboard_webhook_total", { result: "accepted" });
    metrics.increment("alert_dashboard_webhook_total", { result: "error" });
    metrics.increment("alert_dashboard_email_attempt_total", {}, 3);
    metrics.gauge("alert_dashboard_reconciliation_drift", 2);
    metrics.gauge(
      "alert_dashboard_oldest_pending_email_timestamp_seconds",
      1_754_674_400,
    );

    const rendered = metrics.render();
    expect(rendered).toContain(
      'alert_dashboard_webhook_total{result="accepted"} 1',
    );
    expect(rendered).toContain(
      'alert_dashboard_webhook_total{result="error"} 1',
    );
    expect(
      rendered.split("# TYPE alert_dashboard_webhook_total counter").length - 1,
    ).toBe(1);
    expect(rendered).toContain("alert_dashboard_email_attempt_total 3");
    expect(rendered).toContain(
      "# TYPE alert_dashboard_reconciliation_drift gauge",
    );
    expect(rendered).toContain("alert_dashboard_reconciliation_drift 2");
    expect(rendered).toContain(
      "alert_dashboard_oldest_pending_email_timestamp_seconds 1754674400",
    );
  });
});
