import { expect, test } from "vitest";
import { getArtifactsRuleGroups } from "./artifacts.ts";
import { alertExpression, runPromtoolFixture } from "./promtool-fixture.ts";

const GIB = 1024 * 1024 * 1024;

function expressions() {
  const rules = getArtifactsRuleGroups().flatMap((group) => group.rules ?? []);
  const byAlert = (name: string) => alertExpression(rules, name);
  return {
    rules,
    down: byAlert("ArtifactsDown"),
    listen: byAlert("ArtifactsChangeStreamDisconnected"),
    cleanup: byAlert("ArtifactsCleanupStale"),
    blobs: byAlert("ArtifactsBlobStorageLarge"),
    s3: byAlert("ArtifactsObjectStoreErrors"),
  };
}

test("evaluates every artifacts alert healthy and failing", async () => {
  const { rules, down, listen, cleanup, blobs, s3 } = expressions();
  expect(rules.map((rule) => rule.alert)).toEqual([
    "ArtifactsDown",
    "ArtifactsChangeStreamDisconnected",
    "ArtifactsCleanupStale",
    "ArtifactsBlobStorageLarge",
    "ArtifactsObjectStoreErrors",
  ]);
  for (const rule of rules) {
    expect(rule.annotations?.["summary"]).toMatch(/\S/u);
    expect(rule.annotations?.["description"]).toMatch(/\S/u);
  }

  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        // Healthy: scraped, listening, cleaned an hour ago, small, no errors.
        interval: "1m",
        input_series: [
          {
            series: 'up{namespace="artifacts",service="artifacts"}',
            values: "1+0x20",
          },
          { series: "artifacts_listen_connected", values: "1+0x20" },
          {
            series: "artifacts_cleanup_last_success_timestamp_seconds",
            values: "0+0x20",
          },
          {
            series:
              'SeaweedFS_volumeServer_total_disk_size{collection="artifacts-blobs",type="normal"}',
            values: `${String(GIB)}+0x20`,
          },
          { series: 'artifacts_s3_errors_total{op="write"}', values: "3+0x20" },
        ],
        promql_expr_test: [
          { expr: `count(${down})`, eval_time: "15m", exp_samples: [] },
          { expr: `count(${listen})`, eval_time: "15m", exp_samples: [] },
          // promtool's clock starts at 0, so this timestamp is 15 minutes
          // old: inside the 3 hour limit. (On the live service 0 means
          // "never", which is past it until the first cleanup.)
          { expr: `count(${cleanup})`, eval_time: "15m", exp_samples: [] },
          { expr: `count(${blobs})`, eval_time: "15m", exp_samples: [] },
          { expr: `count(${s3})`, eval_time: "15m", exp_samples: [] },
        ],
      },
      {
        // Failing: unscraped, LISTEN down, 60 GiB, errors still climbing.
        interval: "1m",
        input_series: [
          {
            series: 'up{namespace="artifacts",service="artifacts"}',
            values: "0+0x20",
          },
          { series: "artifacts_listen_connected", values: "0+0x20" },
          {
            series: "artifacts_cleanup_last_success_timestamp_seconds",
            values: "0+0x20",
          },
          {
            series:
              'SeaweedFS_volumeServer_total_disk_size{collection="artifacts-blobs",type="normal"}',
            values: `${String(60 * GIB)}+0x20`,
          },
          { series: 'artifacts_s3_errors_total{op="write"}', values: "0+1x20" },
        ],
        promql_expr_test: [
          {
            expr: `count(${down})`,
            eval_time: "15m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: `count(${listen})`,
            eval_time: "15m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: `count(${blobs})`,
            eval_time: "15m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: `count(${s3})`,
            eval_time: "15m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
      {
        // Cleanup: a success at t=1h, evaluated 4 h later, is 3 h old.
        interval: "1m",
        input_series: [
          {
            series: "artifacts_cleanup_last_success_timestamp_seconds",
            values: "3600+0x300",
          },
        ],
        promql_expr_test: [
          { expr: `count(${cleanup})`, eval_time: "2h", exp_samples: [] },
          {
            expr: `count(${cleanup})`,
            eval_time: "4h30m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
    ],
  });
});
