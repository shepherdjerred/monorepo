import { describe, expect, test } from "vitest";
import { runPromtoolFixture } from "./promtool-fixture.ts";
import { getTemporalRuleGroups } from "./temporal.ts";
import {
  DDNS_SYNC_STALE_EXPR,
  DDNS_UPDATE_FAILING_EXPR,
  GIT_BACKUP_REPO_FAILED_EXPR,
  GIT_BACKUP_STALE_EXPR,
  getTemporalOpsScheduleRuleGroups,
} from "./temporal-ops-schedules.ts";

describe("Temporal DDNS and Git-Backup alert rules", () => {
  test("wires DdnsSyncStale, DdnsUpdateFailing, GitBackupStale, and GitBackupRepoFailed into Temporal rule groups", () => {
    const groups = getTemporalRuleGroups();
    const alertNames = groups.flatMap((group) =>
      (group.rules ?? []).map((rule) => rule.alert),
    );
    expect(alertNames).toContain("DdnsSyncStale");
    expect(alertNames).toContain("DdnsUpdateFailing");
    expect(alertNames).toContain("GitBackupStale");
    expect(alertNames).toContain("GitBackupRepoFailed");

    const localGroups = getTemporalOpsScheduleRuleGroups();
    expect(localGroups.map((group) => group.name)).toEqual([
      "temporal-ddns",
      "temporal-git-backup",
    ]);
  });

  test("evaluates DDNS and Git-Backup PromQL expressions cleanly in promtool", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        // Healthy recent DDNS and Git-Backup runs do not fire
        {
          interval: "5m",
          input_series: [
            {
              series:
                'temporal_ddns_last_success_timestamp_seconds{target="ddns.sjer.red"}',
              values: "1800x7",
            },
            {
              series:
                'temporal_ddns_last_success_timestamp_seconds{target="ipv4.ddns.sjer.red"}',
              values: "1800x7",
            },
            {
              series:
                'temporal_ddns_updates_total{target="ddns.sjer.red",action="failed",outcome="failed"}',
              values: "0x7",
            },
            {
              series: "git_backup_last_success_timestamp_seconds",
              values: "1800x7",
            },
            {
              series:
                'git_backup_repo_success{owner="shepherdjerred",repository="monorepo"}',
              values: "1x7",
            },
          ],
          promql_expr_test: [
            { expr: DDNS_SYNC_STALE_EXPR, eval_time: "30m", exp_samples: [] },
            {
              expr: DDNS_UPDATE_FAILING_EXPR,
              eval_time: "30m",
              exp_samples: [],
            },
            { expr: GIT_BACKUP_STALE_EXPR, eval_time: "30m", exp_samples: [] },
            {
              expr: GIT_BACKUP_REPO_FAILED_EXPR,
              eval_time: "30m",
              exp_samples: [],
            },
          ],
        },
        // Stale / failing DDNS and Git-Backup runs fire for the offending targets/repos
        {
          interval: "5m",
          input_series: [
            {
              series:
                'temporal_ddns_last_success_timestamp_seconds{target="ddns.sjer.red"}',
              values: "100x7",
            },
            {
              series:
                'temporal_ddns_last_success_timestamp_seconds{target="ipv4.ddns.sjer.red"}',
              values: "2400x7",
            },
            {
              series:
                'temporal_ddns_updates_total{target="ddns.sjer.red",action="failed",outcome="failed"}',
              values: "0+1x6",
            },
            {
              series:
                'git_backup_repo_success{owner="shepherdjerred",repository="broken-repo"}',
              values: "0x7",
            },
          ],
          promql_expr_test: [
            {
              expr: DDNS_SYNC_STALE_EXPR,
              eval_time: "35m",
              exp_samples: [
                { labels: '{target="ddns.sjer.red"}', value: 2000 },
              ],
            },
            {
              expr: DDNS_UPDATE_FAILING_EXPR,
              eval_time: "30m",
              exp_samples: [{ labels: '{target="ddns.sjer.red"}', value: 6 }],
            },
            {
              expr: GIT_BACKUP_STALE_EXPR,
              eval_time: "30m",
              exp_samples: [{ labels: "{}", value: 1 }],
            },
            {
              expr: GIT_BACKUP_REPO_FAILED_EXPR,
              eval_time: "30m",
              exp_samples: [
                {
                  labels: '{owner="shepherdjerred",repository="broken-repo"}',
                  value: 0,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
