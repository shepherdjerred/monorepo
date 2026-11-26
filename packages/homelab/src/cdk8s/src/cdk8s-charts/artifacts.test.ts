import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { createArtifactsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/artifacts.ts";
import {
  expectActivationMarkerOnly,
  renderedKinds,
} from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/prepared-chart-assertions.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  expectActivationMarkerOnly(createArtifactsChart(new App(), false).toJson());
});

test("an activated service renders its workload", () => {
  expect(renderedKinds(createArtifactsChart(new App(), true).toJson())).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "NetworkPolicy",
      "Service",
      "Ingress",
    ]),
  );
});
