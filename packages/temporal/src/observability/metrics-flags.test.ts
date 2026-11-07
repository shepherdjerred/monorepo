import { expect, test } from "vitest";
import { Registry } from "prom-client";
import { ManagedFlagInventorySchema } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { createFlagInventoryMetrics } from "./metrics-flags.ts";

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
        {
          environment: "prod",
          reason: "owner gate",
          issue: "AI-1",
          enableWhen: "owner acceptance",
          reviewBy: "2026-12-07",
        },
      ],
    })),
  });
  const metrics = createFlagInventoryMetrics(registry, inventory);
  const at = new Date("2026-11-07T00:00:00Z");
  metrics.observePair(
    "prod",
    "test",
    {
      flags: [
        {
          key: "first",
          enabled: true,
          type: "BOOLEAN_FLAG_TYPE",
          rules: [],
          rollouts: [],
        },
        {
          key: "unmanaged",
          enabled: true,
          type: "BOOLEAN_FLAG_TYPE",
          rules: [],
          rollouts: [],
        },
      ],
    },
    at,
  );
  let text = await registry.metrics();
  expect(text).toContain('flag="first",state="on"} 1');
  expect(text).toContain('flag="missing",state="missing"} 1');
  expect(text).toContain('flag="first",issue="AI-1"} 1');
  expect(text).not.toContain("unmanaged");
  expect(text).toContain(
    `feature_flag_inventory_observed_timestamp_seconds{flipt_environment="prod",flipt_namespace="test"} ${String(at.getTime() / 1000)}`,
  );
  metrics.observePair(
    "prod",
    "test",
    {
      flags: [
        {
          key: "first",
          enabled: false,
          type: "BOOLEAN_FLAG_TYPE",
          rules: [],
          rollouts: [],
        },
      ],
    },
    at,
  );
  text = await registry.metrics();
  expect(text).toContain('flag="first",state="on"} 0');
  expect(text).toContain('flag="first",state="off"} 1');
  const before = text;
  expect(() =>
    metrics.observePair("unknown", "test", { flags: [] }, at),
  ).toThrow();
  expect(await registry.metrics()).toBe(before);
  inventory.flags.splice(0, 1);
  metrics.observePair("prod", "test", { flags: [] }, at);
  text = await registry.metrics();
  expect(text).not.toContain('flag="first"');
});
