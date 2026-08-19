import { describe, expect, test } from "bun:test";
import { createAiProviderDashboard } from "./ai-provider-dashboard.ts";
import { createBuildkiteDashboard } from "./buildkite-dashboard.ts";
import { createBuildkitdDashboard } from "./buildkitd-dashboard.ts";
import { createDiscordPlaysDashboard } from "./discord-plays-dashboard.ts";
import { createScoutDashboard } from "./scout-dashboard.ts";
import { createSmartctlDashboard } from "./smartctl-dashboard.ts";
import { createTasknotesDashboard } from "./tasknotes-dashboard.ts";
import { createTemporalDashboard } from "./temporal-dashboard.ts";
import { createStreambotVoiceDashboard } from "./streambot-voice-dashboard.ts";
import { createVeleroDashboard } from "./velero-dashboard.ts";
import { createZfsDashboard } from "./zfs-dashboard.ts";

const dashboardJson = [
  createAiProviderDashboard(),
  createBuildkiteDashboard(),
  createBuildkitdDashboard(),
  createDiscordPlaysDashboard(),
  createScoutDashboard(),
  createSmartctlDashboard(),
  createTasknotesDashboard(),
  createTemporalDashboard(),
  createStreambotVoiceDashboard(),
  createVeleroDashboard(),
  createZfsDashboard(),
]
  .map((dashboard) => JSON.stringify(dashboard))
  .join("\n");

describe("dashboard query health", () => {
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
      String.raw`reports_failed_total{environment=~\"$environment\",instance=~\"$server\"}[5m])) * 60 or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`scheduled_reports_failed_total{environment=~\"$environment\",instance=~\"$server\"}[1h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`scheduled_report_budget_exceeded_total{environment=~\"$environment\",instance=~\"$server\"}[1h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`prematch_loading_screen_skin_fallback_total{environment=~\"$environment\",instance=~\"$server\"}[24h]))) or on() vector(0)`,
    );
  });

  test("AI provider health renders zero while provider issues are quiet", () => {
    expect(dashboardJson).toContain(
      String.raw`ai_provider_issue_active{app=~\"$app\",provider=~\"$provider\",kind=~\"$kind\",source=~\"$source\"})) or on() vector(0)`,
    );
    expect(dashboardJson).toContain(
      String.raw`ai_provider_errors_total{app=~\"$app\",provider=~\"$provider\",kind=~\"$kind\",source=~\"$source\"}[24h])) or on() vector(0)`,
    );
    expect(dashboardJson).toContain("llm_request_duration_seconds_bucket");
    expect(dashboardJson).toContain("llm_router_attempts_total");
    expect(dashboardJson).toContain("llm_structured_output_attempts_total");
    expect(dashboardJson).toContain("openrouter_broadcast_requests_total");
  });
});
