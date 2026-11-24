import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { closeActivationGate } from "./activation.ts";

test("a closed activation gate renders only the inactive marker", () => {
  const chart = new Chart(new App(), "service", {
    namespace: "service",
    disableResourceNameHashes: true,
  });
  expect(closeActivationGate(chart)).toBe(chart);
  expect(Testing.synth(chart)).toEqual([
    {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "service-activation", namespace: "service" },
      data: { active: "false" },
      immutable: false,
    },
  ]);
});
