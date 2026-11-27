import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createArtifactsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/artifacts.ts";
import {
  expectActivationMarkerOnly,
  renderedKinds,
} from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/prepared-chart-assertions.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  ARTIFACTS_APP_INGRESS,
  ARTIFACTS_CONTENT_INGRESS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/artifacts/index.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  spec: z.unknown().optional(),
});

const PolicySpec = z.object({
  ingress: z.array(
    z.object({
      from: z.array(
        z.object({
          podSelector: z
            .object({ matchLabels: z.record(z.string(), z.string()) })
            .optional(),
        }),
      ),
    }),
  ),
});

beforeEach(resetProbeRegistry);

function render(active: boolean) {
  return z
    .array(Manifest)
    .parse(createArtifactsChart(new App(), active).toJson());
}

test("a prepared service renders only its activation marker", () => {
  expectActivationMarkerOnly(createArtifactsChart(new App(), false).toJson());
});

test("an activated service renders its workload", () => {
  expect(renderedKinds(createArtifactsChart(new App(), true).toJson())).toEqual(
    expect.arrayContaining([
      "Namespace",
      "postgresql",
      "OnePasswordItem",
      "Deployment",
      "NetworkPolicy",
      "Service",
      "Ingress",
    ]),
  );
});

test("both tailnet hosts are Ingresses onto the one Service", () => {
  const ingresses = render(true).filter(({ kind }) => kind === "Ingress");
  const names = ingresses.map(({ metadata }) => metadata?.name ?? "");
  expect(names).toHaveLength(2);
  expect(names).toEqual(
    expect.arrayContaining([
      ARTIFACTS_APP_INGRESS.name,
      ARTIFACTS_CONTENT_INGRESS.name,
    ]),
  );
  for (const ingress of ingresses)
    expect(ingress.spec).toMatchObject({
      defaultBackend: {
        service: { name: "artifacts", port: { number: 7440 } },
      },
    });
});

test("the app port admits only the two ingress proxies, by the Ingress they serve", () => {
  const policy = render(true).find(
    ({ kind, metadata }) =>
      kind === "NetworkPolicy" && metadata?.name === "artifacts-app-netpol",
  );
  const labels = PolicySpec.parse(policy?.spec)
    .ingress.flatMap((rule) => rule.from)
    .map(
      (peer) => peer.podSelector?.matchLabels["tailscale.com/parent-resource"],
    )
    .filter((name) => name !== undefined);
  expect(labels).toHaveLength(2);
  expect(labels).toEqual(
    expect.arrayContaining([
      ARTIFACTS_APP_INGRESS.name,
      ARTIFACTS_CONTENT_INGRESS.name,
    ]),
  );
});
