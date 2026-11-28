import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createExperimentsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/experiments.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("the prepared Experiments chart publishes only its namespaced activation marker", () => {
  expect(createExperimentsChart(new App(), false).toJson()).toEqual([
    expect.objectContaining({
      kind: "ConfigMap",
      metadata: { name: "experiments-activation", namespace: "experiments" },
      data: { active: "false" },
    }),
  ]);
});

test("an activated service renders its workload", () => {
  const kinds = z
    .array(Manifest)
    .parse(createExperimentsChart(new App(), true).toJson())
    .map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "NetworkPolicy",
      "Service",
      "Ingress",
    ]),
  );
});
