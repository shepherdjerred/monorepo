import { describe, expect, it } from "vitest";
import {
  getOpsSnapshotRuleGroups,
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

describe("TemporalScheduledCurrentFailure", () => {
  const schedule =
    'temporal_namespace="prod",schedule_id="glitter-corpus-daily",workflow_type="runGlitterCorpusDaily"';

  // Evaluated at 40m, so time() is 2400 and a fresh observation is newer
  // than 600 (time() - 1800).
  function poller(input: {
    pod: string;
    failed: number;
    observedAt: number;
  }): { series: string; values: string }[] {
    const labels = `namespace="temporal",pod="${input.pod}",${schedule}`;
    return [
      {
        series: `temporal_schedule_last_terminal_failed{${labels}}`,
        values: `${String(input.failed)}x40`,
      },
      {
        series: `temporal_schedule_observation_timestamp_seconds{${labels}}`,
        values: `${String(input.observedAt)}x40`,
      },
    ];
  }

  it("fires only while the newest fresh observation reports a failed terminal run", async () => {
    const expr = rule("TemporalScheduledCurrentFailure").expr.value;
    const firing = [{ labels: `{${schedule}}`, value: 1 }];
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          name: "latest terminal run failed",
          series: poller({ pod: "infra-a", failed: 1, observedAt: 2000 }),
          expected: firing,
        },
        {
          name: "a later completed run clears it",
          series: poller({ pod: "infra-a", failed: 0, observedAt: 2000 }),
          expected: [],
        },
        {
          name: "an older poller's failure cannot mask a newer success",
          series: [
            ...poller({ pod: "infra-old", failed: 1, observedAt: 1500 }),
            ...poller({ pod: "infra-new", failed: 0, observedAt: 2000 }),
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
