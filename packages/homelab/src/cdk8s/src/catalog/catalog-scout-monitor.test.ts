import { renderMonitorQuery } from "@shepherdjerred/delivery/model-contract";
import { runPromtoolFixture } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/promtool-fixture.ts";
import { expect, test } from "vitest";
import { ENVIRONMENT_MONITORS } from "./catalog-targets.ts";

const candidate = "a".repeat(40);

function receipt(
  rank: number,
  timestamp: number,
  {
    environment = "beta",
    gitSha = candidate,
    role = "application",
    pod = "scout-a",
  } = {},
) {
  return {
    series: `scout_durable_recent_applied_receipt_timestamp_seconds{environment="${environment}",git_sha="${gitSha}",role="${role}",pod="${pod}",rank="${String(rank)}"}`,
    values: String(timestamp),
  };
}

test("Scout beta counts five distinct ranks from the accepted build after acceptance", async () => {
  const evidence = ENVIRONMENT_MONITORS["scout-for-lol/beta"]?.evidence.find(
    ({ key }) => key === "matches-processed",
  );
  if (!evidence) throw new Error("Missing Scout beta receipt evidence");
  expect(evidence.threshold).toBe(5);
  const expr = renderMonitorQuery(evidence.query, {
    window: "2m",
    version: "1",
    gitSha: candidate,
    acceptedAt: 17.25,
  });
  const excluded = [
    receipt(2, 17.25),
    receipt(3, 16),
    receipt(4, 21),
    receipt(5, 18, { gitSha: "b".repeat(40) }),
    receipt(5, 19, { environment: "prod" }),
    receipt(5, 20, { role: "activity-worker" }),
    receipt(6, 18),
  ];
  const cases = [
    { series: [], count: 0 },
    { series: excluded, count: 0 },
    {
      series: [...excluded, receipt(1, 20), receipt(1, 19, { pod: "scout-b" })],
      count: 1,
    },
    {
      series: [20, 19, 18, 17.5, 17.26].map((time, index) =>
        receipt(index + 1, time),
      ),
      count: 5,
    },
  ];
  await runPromtoolFixture({
    evaluation_interval: "1s",
    tests: cases.map(({ series, count }) => ({
      interval: "1s",
      input_series: series,
      promql_expr_test: [
        {
          expr,
          eval_time: "20s",
          exp_samples: [{ labels: "{}", value: count }],
        },
      ],
    })),
  });
});
