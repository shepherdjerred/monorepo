import { App, Chart } from "cdk8s";
import { beforeEach, describe, expect, it } from "vitest";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  deliveryActivation,
  deliveryExecutorActivation,
  deliveryImageReference,
} from "./activation.ts";
import { z } from "zod";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";
import { assertDeliveryRootPreservesSelection } from "@shepherdjerred/homelab/scripts/argocd/argocd-delivery.ts";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createDeliveryJobs } from "./jobs.ts";
import { createWoodpeckerStepNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";

beforeEach(resetProbeRegistry);
const activation = {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "service-item",
  tailscaleItemId: "tailscale-item",
  executorItemId: "executor-item",
};
const Resources = z.array(
  z
    .object({
      kind: z.string(),
      metadata: z.object({ name: z.string() }),
      spec: z.unknown().optional(),
    })
    .loose(),
);

describe("Delivery infrastructure", () => {
  it("grants publication egress only to the generated publication step", () => {
    const chart = new Chart(new App(), "ci-network");
    createWoodpeckerStepNetworkPolicy(chart);
    const policy = z
      .array(
        z.object({
          spec: z.object({
            podSelector: z
              .object({
                matchLabels: z.record(z.string(), z.string()).optional(),
              })
              .loose(),
            egress: z.unknown(),
          }),
        }),
      )
      .parse(chart.toJson())
      .find(
        (item) =>
          item.spec.podSelector.matchLabels?.["ci.sjer.red/step-key"] ===
          "delivery-publish",
      );
    expect(policy?.spec.egress).toEqual([
      {
        to: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "delivery" },
            },
            podSelector: { matchLabels: { app: "delivery" } },
          },
        ],
        ports: [{ port: 7353, protocol: "TCP" }],
      },
    ]);
  });
  it("keeps disposable stage Pods tokenless and controller grants confined to their own namespace", () => {
    const chart = new Chart(new App(), "job-contract", {
      namespace: "temporal",
    });
    createDeliveryJobs(chart);
    const resources = z
      .array(
        z.object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
          rules: z.unknown().optional(),
          automountServiceAccountToken: z.boolean().optional(),
        }),
      )
      .parse(chart.toJson());
    expect(
      resources.find(
        (item) =>
          item.kind === "ServiceAccount" &&
          item.metadata.name === "delivery-stage",
      ),
    ).toMatchObject({
      metadata: { namespace: "delivery-jobs" },
      automountServiceAccountToken: false,
    });
    expect(resources.find((item) => item.kind === "Role")).toMatchObject({
      metadata: { namespace: "delivery-jobs" },
      rules: [
        { apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get"] },
        { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
        { apiGroups: [""], resources: ["pods/log"], verbs: ["get"] },
      ],
    });
  });
  it("root applies preserve delegated fields and the pilot image has an explicit Helm binding", () => {
    const root = createAppsApp(new Chart(new App(), "apps"));
    expect(() =>
      assertDeliveryRootPreservesSelection(root.toJson()),
    ).not.toThrow();
    const app = new App();
    createArcadeChart(app);
    const chart = app.node.findChild("arcade");
    if (!(chart instanceof Chart))
      throw new TypeError("Arcade chart is missing");
    const resources = JSON.stringify(chart.toJson());
    expect(resources).toContain(".Values.delivery.image");
  });
  it("keeps unpublished and credential-incomplete services inactive", () => {
    expect(
      deliveryImageReference(`0.0.0@sha256:${"0".repeat(64)}`),
    ).toBeUndefined();
    expect(
      deliveryActivation(`2.0.0-42@sha256:${"a".repeat(64)}`),
    ).toBeUndefined();
    expect(
      deliveryExecutorActivation(`2.0.0-42@sha256:${"a".repeat(64)}`),
    ).toBeUndefined();
    expect(createDeliveryChart(new App(), undefined).toJson()).toMatchObject([
      { kind: "ConfigMap", data: { active: "false" } },
    ]);
    expect(() => deliveryImageReference("latest")).toThrow();
  });
  it("authenticates browser traffic through same-Pod Serve, and exposes only the bearer-authenticated machine API", () => {
    const resources = Resources.parse(
      createDeliveryChart(new App(), activation).toJson(),
    );
    const database = resources.find(
      (resource) => resource.kind === "postgresql",
    );
    expect(database).toBeDefined();
    const services = resources.filter(
      (resource) => resource.kind === "Service",
    );
    expect(services.map((service) => service.metadata.name).sort()).toEqual([
      "delivery",
    ]);
    const policy = resources.find(
      (resource) => resource.kind === "NetworkPolicy",
    );
    const spec = z
      .object({
        ingress: z.array(
          z.object({
            from: z.array(z.unknown()),
            ports: z.array(z.object({ port: z.number() })),
          }),
        ),
      })
      .parse(policy?.spec);
    expect(
      spec.ingress
        .flatMap((rule) => rule.ports)
        .every((port) => port.port === 7353),
    ).toBe(true);
    expect(JSON.stringify(spec.ingress)).toContain(
      '"ci.sjer.red/step-key":"delivery-publish"',
    );
    expect(JSON.stringify(spec.ingress)).toContain(
      '"kubernetes.io/metadata.name":"woodpecker-ci"',
    );
    expect(resources.some((resource) => resource.kind === "Ingress")).toBe(
      false,
    );
    const deployment = resources.find(
      (resource) => resource.kind === "Deployment",
    );
    const pod = z
      .object({
        template: z.object({
          spec: z.object({
            automountServiceAccountToken: z.literal(false),
            containers: z.array(
              z.object({
                name: z.string(),
                env: z.array(
                  z.object({ name: z.string(), value: z.string().optional() }),
                ),
              }),
            ),
          }),
        }),
      })
      .parse(deployment?.spec).template.spec;
    expect(
      pod.containers.find((container) => container.name === "tailscale")?.env,
    ).toContainEqual({ name: "TS_KUBE_SECRET", value: "" });
    expect(
      pod.containers.find((container) => container.name === "tailscale")?.env,
    ).toContainEqual({ name: "TS_USERSPACE", value: "true" });
    expect(JSON.stringify(resources)).toContain("http://127.0.0.1:7353");
  });
});
