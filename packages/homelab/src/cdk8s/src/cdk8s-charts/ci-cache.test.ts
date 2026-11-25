import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createCiCacheChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/ci-cache.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("a prepared ci-cache service renders only its activation marker", () => {
  const resources = createCiCacheChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated ci-cache service renders its liskov-scheduled workload", () => {
  const manifests = createCiCacheChart(new App(), true).toJson();
  const kinds = z
    .array(Manifest)
    .parse(manifests)
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
  const deploymentText = JSON.stringify(
    manifests.find((manifest) => manifest.kind === "Deployment"),
  );
  expect(deploymentText).toContain("liskov");
});
