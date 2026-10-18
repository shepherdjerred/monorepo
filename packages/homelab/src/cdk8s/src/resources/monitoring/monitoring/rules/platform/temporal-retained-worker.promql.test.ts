import { expect, test } from "vitest";
import { getTemporalRuleGroups } from "./temporal.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

test.each(["temporal", "scout-beta", "scout-prod"])(
  "%s retained health follows native desired replicas without Git build slots",
  async (namespace) => {
    const rule = getTemporalRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .find(
        (entry) =>
          entry.alert === "TemporalRetainedWorkflowWorkerUnavailable" &&
          entry.labels?.["worker_namespace"] === namespace,
      );
    if (rule === undefined)
      throw new Error("Missing native retained-host alert");
    const deployment = `${namespace}-delivery-wf-retained-aaaaaaaaaaaa`;
    const labels = `namespace="${namespace}",deployment="${deployment}"`;
    const series = (name: string, value: number) => ({
      series: `${name}{${labels}}`,
      values: String(value),
    });
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        { desired: 1, available: 1, fires: false },
        { desired: 1, available: 0, fires: true },
        { desired: 1, available: undefined, fires: true },
        { desired: 0, available: 0, fires: false },
        { desired: undefined, available: undefined, fires: false },
      ].map(({ desired, available, fires }) => ({
        interval: "1m",
        input_series: [
          ...(desired === undefined
            ? []
            : [series("kube_deployment_spec_replicas", desired)]),
          ...(available === undefined
            ? []
            : [series("kube_deployment_status_replicas_available", available)]),
          {
            series: `kube_deployment_status_replicas_available{namespace="${namespace}",deployment="${namespace}-delivery-wf-retained-bbbbbbbbbbbb"}`,
            values: "1",
          },
        ],
        promql_expr_test: [
          {
            expr: rule.expr.value,
            eval_time: "0m",
            exp_samples: fires
              ? [
                  {
                    labels: `{__name__="kube_deployment_spec_replicas",${labels}}`,
                    value: 1,
                  },
                ]
              : [],
          },
        ],
      })),
    });
    expect(rule.labels?.["severity"]).toBe("warning");
  },
);
