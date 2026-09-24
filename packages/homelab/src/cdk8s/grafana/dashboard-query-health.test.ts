import { describe, expect, test } from "vitest";
import { ALL_DASHBOARDS } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { SCOUT_GATEWAY_OWNER_ROLES } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout-alert-constants.ts";

// Derived from the shipped dashboard inventory instead of a hand-kept list. A
// dashboard added to ALL_DASHBOARDS is covered by every check below without
// anyone remembering to edit this file, and the text checked is each
// dashboard's exported JSON - the bytes the Grafana sidecar provisions.
const dashboardJson = ALL_DASHBOARDS.map((dashboard) =>
  dashboard.exportFn(),
).join("\n");

describe("dashboard query health", () => {
  test("reads every dashboard in the shipped inventory", () => {
    // Every other check here is a deny-list over `dashboardJson`, and a
    // deny-list is only as strong as the text it reads. If the inventory ever
    // stopped yielding dashboards, those checks would all pass while covering
    // nothing, so the coverage itself is asserted before anything is denied.
    expect(ALL_DASHBOARDS.length).toBeGreaterThan(0);
    for (const dashboard of ALL_DASHBOARDS) {
      const exported = dashboard.exportFn();
      expect(exported).toContain('"title"');
      expect(dashboardJson).toContain(exported);
    }
  });

  test("does not contain known-invalid PromQL patterns", () => {
    expect(dashboardJson).not.toContain(
      "sum without(pod, instance, container, endpoint) by",
    );
    expect(dashboardJson).not.toContain(
      "zfs_zpool_last_scrub_completion_timestamp{zfs_zpool_last_scrub_completion_timestamp > 0}",
    );
  });

  test("does not query metric families absent from the current cluster", () => {
    expect(dashboardJson).not.toContain("tasknotes_http_");
    expect(dashboardJson).not.toContain("temporal_worker_scout_data_dragon_");
  });

  test("uses the live Kueue, NVMe, PVC, and ZFS metric families", () => {
    for (const metric of [
      "kueue_pending_workloads",
      "kueue_admitted_active_workloads",
      "kueue_local_queue_resource_usage",
      "kueue_local_queue_resource_reservation",
      "kueue_admission_wait_time_seconds_bucket",
      "nvme_data_units_written_total",
      "nvme_host_write_commands_total",
      "nvme_percentage_used_ratio",
      "nvme_available_spare_ratio",
      "nvme_media_errors_total",
      "nvme_unsafe_shutdowns_total",
      "nvme_temperature_celsius",
      "kubelet_volume_stats_inodes_free",
      "zfs_zpool_fragmentation",
      "zfs_zpool_free_bytes",
    ]) {
      expect(dashboardJson).toContain(metric);
    }
  });

  test("joins storage identity on both device path and scrape instance", () => {
    expect(dashboardJson).toContain("on(device, instance)");
    expect(dashboardJson).toContain("on(disk, instance)");
    expect(dashboardJson).not.toMatch(/on\(device\)(?!,)/);
    expect(dashboardJson).not.toMatch(/on\(disk\)(?!,)/);
  });

  test("projects PVC runway from a full history and the actual positive slope", () => {
    expect(dashboardJson).toContain(
      String.raw`kubelet_volume_stats_used_bytes{persistentvolumeclaim=~\"$volume\"} offset 7d`,
    );
    expect(dashboardJson).not.toContain(
      "clamp_min(deriv(kubelet_volume_stats_used_bytes",
    );
  });

  test("expected-quiet Scout failure panels render zero instead of no data", () => {
    expect(dashboardJson).toContain(
      String.raw`reports_failed_total{environment=~\"$environment\",role=~\"$role\",instance=~\"$instance\"}[5m])) * 60 or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`scheduled_reports_failed_total{environment=~\"$environment\",role=~\"$role\",instance=~\"$instance\"}[1h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`scheduled_report_budget_exceeded_total{environment=~\"$environment\",role=~\"$role\",instance=~\"$instance\"}[1h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`prematch_loading_screen_skin_fallback_total{environment=~\"$environment\",role=~\"$role\",instance=~\"$instance\"}[24h]))) or on() vector(0)`,
    );
  });

  test("swept durable gauges show no-data rather than a green zero", () => {
    // The inverse of the test above, and the distinction matters more here. An
    // `increase()` over a counter is genuinely 0 when nothing happened. A gauge
    // produced by one sweeping role is ABSENT when that role is down, when the
    // sweep has not run yet, or when `$role` is narrowed to a pod that does not
    // sweep — and substituting 0 there would have an acceptance dashboard
    // certify a clean pipeline at the exact moment it can see nothing.
    for (const selector of [
      String.raw`state=\"unknown-delivery\"`,
      String.raw`family=\"unaccepted-workflow-starts\"`,
      String.raw`family=\"stalled-match-processing\"`,
      String.raw`family=\"live-recovery-batches\"`,
    ]) {
      const index = dashboardJson.indexOf(selector);
      expect(index).toBeGreaterThan(-1);
      // The fallback, when present, is appended directly to the expression.
      const expressionTail = dashboardJson.slice(index, index + 200);
      expect(expressionTail).not.toContain("or on() vector(0)");
    }
  });

  test("the Discord connection panel ignores the role variable", () => {
    // Every pod exports discord_connection_status, and a pod with no shard
    // exports a truthful 0. With $role on All the min() reports the application
    // pod and paints the panel red while the bot is connected, so this panel
    // pins the gateway-owning role rather than inheriting the selection.
    //
    // The expected role set is DERIVED from the same constant the panel is
    // built from rather than spelled out here. Hardcoding it is what made this
    // assertion go stale when beta flipped to `gateway`: the panel had
    // correctly followed the constant and only the test was left behind.
    // Deriving keeps the real claim — the panel tracks the deployed owners —
    // and survives the next stage's flip.
    const ownerRoles = SCOUT_GATEWAY_OWNER_ROLES.join("|");
    expect(dashboardJson).toContain(
      String.raw`min by (environment) (discord_connection_status{environment=~\"$environment\",role=~\"` +
        ownerRoles +
        String.raw`\",instance=~\"$instance\"})`,
    );
    expect(dashboardJson).not.toContain(
      String.raw`min by (environment) (discord_connection_status{environment=~\"$environment\",role=~\"$role\"`,
    );
  });

  test("Temporal worker scrape status detects missing canonical targets", () => {
    expect(dashboardJson).toContain(
      String.raw`absent(up{namespace=\"temporal\"`,
    );
    expect(dashboardJson).toContain(
      String.raw`count(up{namespace=\"temporal\"`,
    );
    expect(dashboardJson).toContain(") < 9 or min(up{");
  });

  test("AI provider health renders zero while provider issues are quiet", () => {
    expect(dashboardJson).toContain(
      String.raw`ai_provider_issue_active{app=~\"$app\",provider=~\"$provider\",kind=~\"$kind\",source=~\"$source\"})) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`ai_provider_errors_total{app=~\"$app\",provider=~\"$provider\",kind=~\"$kind\",source=~\"$source\"}[24h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain("llm_request_duration_seconds_bucket");
    expect(dashboardJson).toContain("llm_structured_output_attempts_total");
    expect(dashboardJson).toContain("llm_billed_cost_usd");
    expect(dashboardJson).toContain(
      "llm_billed_reconciliation_last_success_timestamp_seconds",
    );
    // The router and its Broadcast webhook are gone; their metric families
    // are never emitted again, so a panel on them would read zero forever.
    expect(dashboardJson).not.toContain("llm_router_attempts_total");
    expect(dashboardJson).not.toContain("openrouter");
  });
});
