import { expect, test } from "vitest";
import { Registry } from "prom-client";
import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import {
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { createFlagInventoryMetrics } from "./metrics-flags.ts";

const testDeployment: FlagDeployment = {
  id: "test/prod",
  catalog: "test",
  stage: "prod",
};

test("publishes bounded one-hot states, missing flags, scoped exceptions and fresh timestamps", async () => {
  const registry = new Registry();
  const inventory = ManagedFlagInventorySchema.parse({
    version: 3,
    namespaces: [{ key: "test", name: "test", description: "test" }],
    environments: [{ key: "prod", overrides: [] }],
    exemptions: [],
    flags: ["first", "missing"].map((key) => ({
      key,
      namespace: "test",
      owner: "test",
      source: "test",
      purpose: "test",
      type: "boolean",
      default: false,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
      defaultOffExceptions: [
        key === "first"
          ? {
              environment: "prod",
              reason: "owner gate",
              issue: "AI-1",
              enableWhen: "owner acceptance",
              reviewBy: "2026-12-07",
            }
          : {
              environment: "prod",
              reason: "no deployed service in this environment",
              issue: "AI-2",
              enableWhen: "a consumer is deployed in this environment",
              noDeployedConsumer: true as const,
            },
      ],
    })),
  });
  const metrics = createFlagInventoryMetrics(registry, inventory, [
    testDeployment,
  ]);
  const at = new Date("2026-11-07T00:00:00Z");
  metrics.observeDeployment(
    testDeployment,
    [
      {
        type: "boolean",
        key: "first",
        default: true,
        rollouts: [],
      },
      {
        type: "boolean",
        key: "unmanaged",
        default: true,
        rollouts: [],
      },
    ],
    at,
  );
  let text = await registry.metrics();
  expect(text).toContain('flag="first",state="on"} 1');
  expect(text).toContain('flag="missing",state="missing"} 1');
  expect(text).toContain('flag="first",issue="AI-1"} 1');
  expect(text).toContain(
    'feature_flag_exception_review_timestamp_seconds{deployment="test/prod",flag="first",issue="AI-1"}',
  );
  expect(text).toContain('flag="missing",issue="AI-2"} 1');
  expect(text).not.toContain(
    'feature_flag_exception_review_timestamp_seconds{deployment="test/prod",flag="missing",issue="AI-2"}',
  );
  expect(text).not.toContain("unmanaged");
  expect(text).toContain(
    `feature_flag_inventory_observed_timestamp_seconds{deployment="test/prod"} ${String(at.getTime() / 1000)}`,
  );
  metrics.observeDeployment(
    testDeployment,
    [
      {
        type: "boolean",
        key: "first",
        default: false,
        rollouts: [],
      },
    ],
    at,
  );
  text = await registry.metrics();
  expect(text).toContain('flag="first",state="on"} 0');
  expect(text).toContain('flag="first",state="off"} 1');
  const before = text;
  expect(() =>
    metrics.observeDeployment(
      {
        id: "unknown/prod",
        catalog: "unknown",
        stage: "prod",
      },
      [],
      at,
    ),
  ).toThrow();
  expect(await registry.metrics()).toBe(before);
  inventory.flags.splice(0, 1);
  metrics.observeDeployment(testDeployment, [], at);
  text = await registry.metrics();
  expect(text).not.toContain('flag="first"');
});

test("sets expected gauges only for active flagDeployments and matches observed labels 1-to-1", async () => {
  const registry = new Registry();
  const metrics = createFlagInventoryMetrics(registry, managedFlagInventory);
  const at = new Date("2026-11-22T00:00:00Z");

  for (const deployment of flagDeployments) {
    metrics.observeDeployment(
      deployment,
      projectDeploymentFlags(deployment),
      at,
    );
  }

  const json = await registry.getMetricsAsJSON();
  const expectedMetric = json.find(
    (entry) => entry.name === "feature_flag_inventory_expected",
  );
  const observedMetric = json.find(
    (entry) =>
      entry.name === "feature_flag_inventory_observed_timestamp_seconds",
  );
  const expectedPairs = (expectedMetric?.values ?? [])
    .map((v) => String(v.labels["deployment"]))
    .toSorted();
  const observedPairs = (observedMetric?.values ?? [])
    .map((v) => String(v.labels["deployment"]))
    .toSorted();

  expect(expectedPairs).toHaveLength(19);
  expect(observedPairs).toEqual(expectedPairs);
  expect(expectedPairs).toContain("golink/prod");
  expect(expectedPairs).toContain("feeds/prod");
  expect(expectedPairs).toContain("storm/prod");
  expect(expectedPairs).not.toContain("temporal/beta");
  expect(expectedPairs).not.toContain("justin/prod");
});
