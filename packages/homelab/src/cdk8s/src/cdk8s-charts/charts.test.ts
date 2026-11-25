import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createChartsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/charts.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("a prepared charts service renders only its activation marker", () => {
  const resources = createChartsChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated charts service renders its persistent workload", () => {
  const kinds = z
    .array(Manifest)
    .parse(createChartsChart(new App(), true).toJson())
    .map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "PersistentVolumeClaim",
      "NetworkPolicy",
      "Service",
      "Ingress",
    ]),
  );
});
