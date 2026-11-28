import { describe, expect, it } from "vitest";
import {
  getOpsSnapshotRuleGroups,
  INCIDENTS_SIGNAL_FAILING_FOR,
  OPS_SNAPSHOT_SOURCE_STALE_SECONDS,
  OPS_SNAPSHOT_STALE_SECONDS,
} from "./ops-snapshot.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";

function rule(name: string) {
  const found = getOpsSnapshotRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((candidate) => candidate.alert === name);
  if (found === undefined) {
    throw new Error(`expected ${name} rule`);
  }
  return found;
}

describe("ops snapshot freshness rules", () => {
  it("fires when the snapshot stops publishing or was never published", () => {
    const stale = rule("OpsSnapshotStale");

    expect(OPS_SNAPSHOT_STALE_SECONDS).toBe(1800);
    expect(stale.expr.value).toContain(
      "time() - max(ops_snapshot_published_timestamp_seconds) > 1800",
    );
    expect(stale.expr.value).toContain(
      "absent(ops_snapshot_published_timestamp_seconds)",
    );
    expect(stale.labels?.["severity"]).toBe("warning");
  });

  it("alerts per source rather than once for all sources", () => {
    const sourceStale = rule("OpsSnapshotSourceStale");

    expect(OPS_SNAPSHOT_SOURCE_STALE_SECONDS).toBe(3600);
    expect(sourceStale.expr.value).toBe(
      "time() - max by (source) (ops_snapshot_source_last_success_timestamp_seconds) > 3600",
    );
    expect(sourceStale.labels?.["severity"]).toBe("warning");
  });

  it("escapes label templates for Helm", () => {
    const sourceStale = rule("OpsSnapshotSourceStale");

    expect(sourceStale.annotations?.["summary"]).toContain(
      '{{ "{{" }} $labels.source {{ "}}" }}',
    );
  });
});

describe("IncidentsSignalDeliveryFailing", () => {
  it("pages per producer once every post has failed for half an hour", () => {
    const failing = rule("IncidentsSignalDeliveryFailing");

    expect(INCIDENTS_SIGNAL_FAILING_FOR).toBe("30m");
    expect(failing.expr.value).toBe(
      "max by (source) (incidents_signal_post_ok) == 0",
    );
    expect(failing.for).toBe("30m");
    expect(failing.labels?.["severity"]).toBe("warning");
  });

  it("matches a producer whose last post failed and clears once one succeeds", async () => {
    const expr = rule("IncidentsSignalDeliveryFailing").expr.value;
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          series: "0x40",
          expected: [{ labels: '{source="main-ci"}', value: 0 }],
        },
        { series: "0x20 1x20", expected: [] },
      ].map(({ series, expected }) => ({
        interval: "1m",
        input_series: [
          {
            series: 'incidents_signal_post_ok{source="main-ci",pod="ops-a"}',
            values: series,
          },
        ],
        promql_expr_test: [{ expr, eval_time: "40m", exp_samples: expected }],
      })),
    });
  });
});

describe("TemporalScheduledCurrentFailure", () => {
  const schedule =
    'temporal_namespace="prod",schedule_id="glitter-corpus-daily",workflow_type="runGlitterCorpusDaily"';
  const outputLabels =
    'exported_namespace="prod",schedule_id="glitter-corpus-daily",temporal_namespace="prod"';

  // Evaluated at 40m, so time() is 2400 and a fresh observation is newer
  // than 600 (time() - 1800).
  function poller(input: {
    pod: string;
    failed: number;
    observedAt: number;
    valuesPrefix?: string;
    count?: number;
  }): { series: string; values: string }[] {
    const labels = `namespace="temporal",pod="${input.pod}",${schedule}`;
    const count = input.count ?? 40;
    const prefix =
      input.valuesPrefix === undefined ? "" : `${input.valuesPrefix} `;
    return [
      {
        series: `temporal_schedule_last_terminal_failed{${labels}}`,
        values: `${prefix}${String(input.failed)}x${String(count)}`,
      },
      {
        series: `temporal_schedule_observation_timestamp_seconds{${labels}}`,
        values: `${prefix}${String(input.observedAt)}x${String(count)}`,
      },
    ];
  }

  it("holds firing for 15m and carries exported_namespace and schedule_id for inhibition", () => {
    const scheduledFailure = rule("TemporalScheduledCurrentFailure");
    expect(scheduledFailure.keepFiringFor).toBe("15m");
    expect(scheduledFailure.expr.value).toContain(
      "last_over_time(temporal_schedule_last_terminal_failed[20m])",
    );
    expect(scheduledFailure.expr.value).toContain(
      "last_over_time(temporal_schedule_observation_timestamp_seconds[20m])",
    );
  });

  it("fires across single-replica rollout gaps while respecting newer pollers and freshness", async () => {
    const expr = rule("TemporalScheduledCurrentFailure").expr.value;
    const firing = [{ labels: `{${outputLabels}}`, value: 1 }];
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          name: "latest terminal run failed",
          series: poller({ pod: "infra-a", failed: 1, observedAt: 2000 }),
          expected: firing,
        },
        {
          name: "single-replica rollout gap past 5m staleness keeps the alert active",
          series: [
            {
              series: `temporal_schedule_last_terminal_failed{namespace="temporal",pod="infra-a",${schedule}}`,
              values: "1x28 _x12",
            },
            {
              series: `temporal_schedule_observation_timestamp_seconds{namespace="temporal",pod="infra-a",${schedule}}`,
              values: "1600x28 _x12",
            },
          ],
          expected: firing,
        },
        {
          name: "a later completed run clears it",
          series: poller({ pod: "infra-a", failed: 0, observedAt: 2000 }),
          expected: [],
        },
        {
          name: "an older poller's failure inside 20m cannot mask a newer pod's success",
          series: [
            {
              series: `temporal_schedule_last_terminal_failed{namespace="temporal",pod="infra-old",${schedule}}`,
              values: "1x28 _x12",
            },
            {
              series: `temporal_schedule_observation_timestamp_seconds{namespace="temporal",pod="infra-old",${schedule}}`,
              values: "1500x28 _x12",
            },
            ...poller({
              pod: "infra-new",
              failed: 0,
              observedAt: 2000,
              valuesPrefix: "_x30",
              count: 10,
            }),
          ],
          expected: [],
        },
        {
          name: "stale observations do not claim a current failure",
          series: poller({ pod: "infra-a", failed: 1, observedAt: 100 }),
          expected: [],
        },
      ].map(({ series, expected }) => ({
        interval: "1m",
        input_series: series,
        promql_expr_test: [{ expr, eval_time: "40m", exp_samples: expected }],
      })),
    });
  });
});
