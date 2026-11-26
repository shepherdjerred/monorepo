import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import {
  createChartsBootstrapChart,
  createChartsChart,
} from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/charts.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});

beforeEach(resetProbeRegistry);

test("a prepared charts service renders only its activation marker", () => {
  const resources = createChartsChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated charts service renders its persistent workload via charts-bootstrap with preserved charts identities", () => {
  const legacyManifests: unknown[] = createChartsChart(
    new App(),
    true,
  ).toJson();
  resetProbeRegistry();
  const bootstrapManifests: unknown[] = createChartsBootstrapChart(
    new App(),
    true,
  ).toJson();

  expect(bootstrapManifests).toEqual(legacyManifests);

  const parsed = z.array(Manifest).parse(bootstrapManifests);
  expect(
    parsed.map((manifest) => `${manifest.kind}/${manifest.metadata.name}`),
  ).toEqual([
    "Namespace/charts",
    "Deployment/charts",
    "OnePasswordItem/charts-basic-auth",
    "PersistentVolumeClaim/charts-data",
    "Service/charts",
    "ServiceMonitor/charts-service-monitor",
    "Ingress/charts-charts-ingress-ingress",
    "NetworkPolicy/charts-app-netpol",
  ]);
  expect(
    parsed.find((manifest) => manifest.kind === "Deployment"),
  ).toMatchObject({
    spec: {
      selector: {
        matchLabels: { "cdk8s.io/metadata.addr": "charts-c88103a9" },
      },
    },
  });
  expect(createChartsChart(new App()).toJson()).toHaveLength(1);
});
