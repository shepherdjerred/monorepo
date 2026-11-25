import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createErrorsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/errors.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  const resources = createErrorsChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated service renders its workload", () => {
  const kinds = z
    .array(Manifest)
    .parse(createErrorsChart(new App(), true).toJson())
    .map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "postgresql",
      "OnePasswordItem",
      "Deployment",
      "NetworkPolicy",
      "Service",
      "Ingress",
      "TunnelBinding",
    ]),
  );
});
