import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createMinecraftShuxinApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-shuxin.ts";
import { createMinecraftSjerredApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-sjerred.ts";
import {
  getProductionResourceMonitoringRuleGroups,
  WAKE_REQUEST_BYTES,
} from "./resource-monitoring-production.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

const GIBIBYTE = 1024 ** 3;

function productionRule(alert: string) {
  const rule = getProductionResourceMonitoringRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((entry) => entry.alert === alert);
  if (rule === undefined) throw new Error(`Missing ${alert}`);
  return rule;
}

const HibernatingMinecraftSchema = z.object({
  kind: z.literal("Application"),
  spec: z.object({
    source: z.object({
      helm: z.object({
        valuesObject: z.object({
          replicaCount: z.literal(0),
          resources: z.object({
            requests: z.object({ memory: z.string().regex(/^\d+Gi$/u) }),
          }),
        }),
      }),
    }),
  }),
});

function hibernatingMinecraftRequests(): number[] {
  const app = new App();
  const chart = new Chart(app, "games");
  createMinecraftShuxinApp(chart);
  createMinecraftSjerredApp(chart);
  return z
    .array(z.unknown())
    .parse(chart.toJson())
    .map((manifest) => HibernatingMinecraftSchema.safeParse(manifest))
    .flatMap((result) =>
      result.success
        ? [
            Number.parseInt(
              result.data.spec.source.helm.valuesObject.resources.requests
                .memory,
              10,
            ) * GIBIBYTE,
          ]
        : [],
    );
}

const node = 'node="torvalds"';

function request(input: { pod: string; bytes: number; instance?: string }) {
  return {
    series: `kube_pod_container_resource_requests{namespace="apps",pod="${input.pod}",container="main",${node},resource="memory",instance="${input.instance ?? "ksm-a"}"}`,
    values: String(input.bytes),
  };
}

function phase(pod: string, value: string, running: boolean) {
  return [
    {
      series: `kube_pod_status_phase{namespace="apps",pod="${pod}",phase="Running"}`,
      values: running ? "1" : "0",
    },
    {
      series: `kube_pod_status_phase{namespace="apps",pod="${pod}",phase="${value}"}`,
      values: "1",
    },
  ];
}

function info(pod: string, priorityClass: string) {
  return {
    series: `kube_pod_info{namespace="apps",pod="${pod}",${node},priority_class="${priorityClass}"}`,
    values: "1",
  };
}

describe("ProductionWakeCapacityInsufficient", () => {
  it("tracks the largest scale-to-zero Minecraft request", () => {
    const requests = hibernatingMinecraftRequests();
    expect(requests).toHaveLength(2);
    expect(WAKE_REQUEST_BYTES).toBe(Math.max(...requests));
  });

  it("replaces the percentage-of-allocatable request alert", () => {
    const alerts = getProductionResourceMonitoringRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .map((entry) => entry.alert);
    expect(alerts).not.toContain("ProductionNodeMemoryRequestsHigh");
    const rule = productionRule("ProductionWakeCapacityInsufficient");
    expect(rule.for).toBe("30m");
    expect(rule.labels?.["severity"]).toBe("warning");
  });

  it("counts only live, non-preemptible requests once each", async () => {
    const expr = productionRule("ProductionWakeCapacityInsufficient").expr
      .value;
    const cluster = (serviceGibibytes: number) => [
      {
        series: `kube_node_status_allocatable{${node},resource="memory"}`,
        values: String(20 * GIBIBYTE),
      },
      // A normal service, reported twice during a kube-state-metrics rollout.
      request({ pod: "service", bytes: serviceGibibytes * GIBIBYTE }),
      request({
        pod: "service",
        bytes: serviceGibibytes * GIBIBYTE,
        instance: "ksm-b",
      }),
      ...phase("service", "Running", true),
      info("service", "service-standard"),
      // A batch worker a waking game may preempt.
      request({ pod: "batch", bytes: 4 * GIBIBYTE }),
      ...phase("batch", "Running", true),
      info("batch", "batch-low"),
      // A finished pod the scheduler no longer counts.
      request({ pod: "finished", bytes: 5 * GIBIBYTE }),
      ...phase("finished", "Succeeded", false),
      info("finished", "service-standard"),
    ];
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          serviceGibibytes: 13,
          expected: [{ labels: `{${node}}`, value: 7 * GIBIBYTE }],
        },
        { serviceGibibytes: 12, expected: [] },
      ].map(({ serviceGibibytes, expected }) => ({
        interval: "1m",
        input_series: cluster(serviceGibibytes),
        promql_expr_test: [{ expr, eval_time: "0m", exp_samples: expected }],
      })),
    });
  });
});
