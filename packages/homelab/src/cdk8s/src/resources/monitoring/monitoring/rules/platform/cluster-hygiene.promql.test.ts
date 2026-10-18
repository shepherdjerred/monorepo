import { expect, test } from "vitest";
import { getClusterHygieneRuleGroups } from "./cluster-hygiene.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

function clusterHygieneRule(alert: string) {
  const rule = getClusterHygieneRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((entry) => entry.alert === alert);
  if (rule === undefined) throw new Error(`Missing ${alert}`);
  return rule;
}

test("Alloy unwind alerts fire on a full table, not on the normal plateau", async () => {
  const alerts = getClusterHygieneRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .map((entry) => entry.alert);
  expect(alerts).not.toContain("AlloyUnwindTableHigh");
  expect(alerts).not.toContain("AlloyUnwindTableCritical");

  const rule = clusterHygieneRule("AlloyUnwindTableFull");
  expect(rule.labels?.["severity"]).toBe("warning");
  const labels = 'namespace="alloy",pod="alloy-a"';
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      // 96.5% is where a busy production node settles; 16,383 is one entry
      // short of the 16,384-entry capacity.
      { size: 15_811, fires: false },
      { size: 16_383, fires: false },
      { size: 16_384, fires: true },
    ].map(({ size, fires }) => ({
      interval: "1m",
      input_series: [
        {
          series: `agent_unwind_info_array_size{${labels}}`,
          values: String(size),
        },
      ],
      promql_expr_test: [
        {
          expr: rule.expr.value,
          eval_time: "0m",
          exp_samples: fires
            ? [
                {
                  labels: `{__name__="agent_unwind_info_array_size",${labels}}`,
                  value: size,
                },
              ]
            : [],
        },
      ],
    })),
  });
});
