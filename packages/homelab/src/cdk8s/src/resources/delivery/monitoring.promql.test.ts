import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  DELIVERY_QUEUE_STALL_SECONDS,
  deliveryAlertRules,
} from "./monitoring.ts";

const target = 'namespace="delivery",service="delivery"';
const ALERTS = new Set([
  "DeliveryRecoveryRequired",
  "DeliveryQueueStalled",
  "DeliveryPlatformLockStranded",
]);

/** Undo the Helm escaping so Prometheus sees the templates the cluster renders. */
function unescapeHelm(value: string) {
  return value.replaceAll('{{ "{{" }}', "{{").replaceAll('{{ "}}" }}', "}}");
}

function renderedRules(annotations: boolean) {
  return {
    groups: [
      {
        name: "delivery-control-plane",
        rules: deliveryAlertRules(true)
          .filter((rule) => ALERTS.has(rule.alert))
          .map((rule) => ({
            alert: rule.alert,
            expr: rule.expr.value,
            for: rule.for,
            labels: rule.labels,
            ...(annotations
              ? {
                  annotations: Object.fromEntries(
                    Object.entries(rule.annotations).map(([key, value]) => [
                      key,
                      unescapeHelm(value),
                    ]),
                  ),
                }
              : {}),
          })),
      },
    ],
  };
}

const holder = (
  environment: string,
  service: string,
  selfHosted: boolean,
  values: string,
) => ({
  series: `delivery_recovery_required_deployments{${target},environment="${environment}",service_id="${service}",self_hosted="${String(selfHosted)}"}`,
  values,
});
const held = (environment: string, service: string, selfHosted: boolean) => ({
  exp_labels: {
    severity: "warning",
    environment,
    service_id: service,
    self_hosted: String(selfHosted),
  },
});
const wait = (environment: string, values: string, namespace = "delivery") => ({
  series: `delivery_queued_oldest_seconds{namespace="${namespace}",service="delivery",environment="${environment}"}`,
  values,
});
const stalled = (environment: string) => ({
  exp_labels: { severity: "warning", environment },
});
const platformLock = (
  environment: string,
  owner: {
    status: string;
    recoveryRequired?: boolean;
    producerBarrier?: boolean;
    namespace?: string;
  },
  values: string,
) => ({
  series: `delivery_platform_lock_held_seconds{namespace="${owner.namespace ?? "delivery"}",service="delivery",environment="${environment}",service_id="${environment.split("/")[0] ?? ""}",holder_status="${owner.status}",recovery_required="${String(owner.recoveryRequired ?? false)}",producer_barrier="${String(owner.producerBarrier ?? false)}"}`,
  values,
});
const stranded = (environment: string, status: string) => ({
  exp_labels: {
    severity: "warning",
    environment,
    service_id: environment.split("/")[0] ?? "",
    holder_status: status,
  },
});

test("stalled-dispatch alerts fire on held targets, queue age and stranded platform locks, not on cleared or fresh waits", async () => {
  const start = DELIVERY_QUEUE_STALL_SECONDS - 600;
  const directory = await mkdtemp(path.join(tmpdir(), "delivery-promql-"));
  try {
    const rules = path.join(directory, "rules.json");
    const cases = path.join(directory, "cases.json");
    await Bun.write(
      path.join(directory, "templated.json"),
      JSON.stringify(renderedRules(true)),
    );
    // Validates the annotation templates; the unit tests below compare labels only.
    await $`promtool check rules ${path.join(directory, "templated.json")}`.quiet();
    await Bun.write(rules, JSON.stringify(renderedRules(false)));
    await Bun.write(
      cases,
      JSON.stringify({
        rule_files: [rules],
        evaluation_interval: "1m",
        tests: [
          {
            name: "each recovery-required target alerts once its short hold passes",
            interval: "1m",
            input_series: [
              holder("delivery/prod", "delivery", true, "1x30"),
              holder("woodpecker/prod", "woodpecker", false, "_x10 1x20"),
              holder("scout/beta", "scout", false, "1x2 _x28"),
              {
                series: `delivery_recovery_required_deployments{namespace="other",service="delivery",environment="x/prod",service_id="x",self_hosted="true"}`,
                values: "1x30",
              },
            ],
            alert_rule_test: [
              {
                alertname: "DeliveryRecoveryRequired",
                eval_time: "4m",
                exp_alerts: [],
              },
              {
                alertname: "DeliveryRecoveryRequired",
                eval_time: "8m",
                exp_alerts: [held("delivery/prod", "delivery", true)],
              },
              {
                alertname: "DeliveryRecoveryRequired",
                eval_time: "20m",
                exp_alerts: [
                  held("delivery/prod", "delivery", true),
                  held("woodpecker/prod", "woodpecker", false),
                ],
              },
            ],
          },
          {
            name: "a queue alerts after the stall threshold holds, and a claim clears it",
            interval: "1m",
            // Each wait grows a minute per minute from ten minutes under the threshold.
            input_series: [
              wait("delivery-control-plane/prod", `${String(start)}+60x60`),
              wait("arcade/prod", `${String(start)}+60x15 _x45`),
              wait("tsmc/prod", "600+60x60"),
              wait("other/prod", `${String(start)}+60x60`, "elsewhere"),
            ],
            alert_rule_test: [
              {
                alertname: "DeliveryQueueStalled",
                eval_time: "15m",
                exp_alerts: [],
              },
              {
                alertname: "DeliveryQueueStalled",
                eval_time: "25m",
                exp_alerts: [stalled("delivery-control-plane/prod")],
              },
            ],
          },
          {
            name: "a settled holder that keeps the platform lock alerts; running, recovering and barrier holders do not",
            interval: "1m",
            // Only one row can hold the lock; each series is its own scenario.
            input_series: [
              platformLock(
                "delivery-control-plane/prod",
                { status: "failed" },
                "60+60x30",
              ),
              platformLock(
                "tofu-github/prod",
                { status: "canceled" },
                "60+60x3 _x27",
              ),
              platformLock(
                "tofu-cloudflare/prod",
                { status: "running" },
                "60+60x30",
              ),
              platformLock(
                "cluster-admission/prod",
                { status: "failed", recoveryRequired: true },
                "60+60x30",
              ),
              platformLock(
                "blog/prod",
                { status: "failed", producerBarrier: true },
                "60+60x30",
              ),
              platformLock(
                "tofu-arr/prod",
                { status: "failed", namespace: "elsewhere" },
                "60+60x30",
              ),
            ],
            alert_rule_test: [
              {
                alertname: "DeliveryPlatformLockStranded",
                eval_time: "4m",
                exp_alerts: [],
              },
              {
                alertname: "DeliveryPlatformLockStranded",
                eval_time: "10m",
                exp_alerts: [stranded("delivery-control-plane/prod", "failed")],
              },
            ],
          },
        ],
      }),
    );
    await $`promtool test rules ${cases}`.quiet();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery commands and the dispatch barrier are named in the alert", () => {
  const rule = deliveryAlertRules(true).find(
    (candidate) => candidate.alert === "DeliveryRecoveryRequired",
  );
  expect(rule?.annotations.message).toContain(
    "toolkit deploy recover <DEPLOYMENT_ID>",
  );
  expect(rule?.annotations.message).toContain("--operation-id");
  expect(rule?.annotations.message).toContain("toolkit deploy workers recover");
  expect(rule?.annotations.message).toContain("dispatch barrier");
});

test("the stranded platform lock alert names its holder and consequence", () => {
  const rule = deliveryAlertRules(true).find(
    (candidate) => candidate.alert === "DeliveryPlatformLockStranded",
  );
  expect(rule?.annotations.message).toContain("platform lock");
  expect(rule?.annotations.message).toContain("BUSY");
  expect(rule?.annotations).toMatchObject({
    runbook_url: expect.stringContaining(
      "respond-to-a-stalled-delivery-dispatch",
    ),
  });
});
