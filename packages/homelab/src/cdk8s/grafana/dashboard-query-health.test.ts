import { describe, expect, test } from "bun:test";
import { createAiProviderDashboard } from "./ai-provider-dashboard.ts";
import { createBuildkiteDashboard } from "./buildkite-dashboard.ts";
import { createDiscordPlaysDashboard } from "./discord-plays-dashboard.ts";
import { createPrReviewBotDashboard } from "./pr-review-bot-dashboard.ts";
import { createScoutDashboard } from "./scout-dashboard.ts";
import { createTasknotesDashboard } from "./tasknotes-dashboard.ts";
import { createTemporalDashboard } from "./temporal-dashboard.ts";
import { createVeleroDashboard } from "./velero-dashboard.ts";
import { createZfsDashboard } from "./zfs-dashboard.ts";

const dashboardJson = [
  createAiProviderDashboard(),
  createBuildkiteDashboard(),
  createDiscordPlaysDashboard(),
  createPrReviewBotDashboard(),
  createScoutDashboard(),
  createTasknotesDashboard(),
  createTemporalDashboard(),
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
    expect(dashboardJson).not.toContain("kueue_");
    expect(dashboardJson).not.toContain("tasknotes_http_");
    expect(dashboardJson).not.toContain("temporal_worker_scout_data_dragon_");
    expect(dashboardJson).not.toContain("label_velero_io_backup");
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
  });
});
