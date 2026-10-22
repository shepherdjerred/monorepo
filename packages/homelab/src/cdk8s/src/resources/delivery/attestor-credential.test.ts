import { App } from "cdk8s";
import { beforeEach, expect, test } from "vitest";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  DELIVERY_ATTESTOR_CREDENTIAL as attestor,
  DELIVERY_CREDENTIAL_ITEMS,
} from "./activation.ts";

beforeEach(resetProbeRegistry);

test("the attestor is a distinct operator identity held in the Delivery service item", () => {
  expect(attestor.itemId).toBe(DELIVERY_CREDENTIAL_ITEMS.service);
  expect(attestor.principal.kind).toBe("machine");
  expect(attestor.principal.scopes).toContain("attest");
  // The API refuses any attestation credential that also executes.
  expect(attestor.principal.scopes).not.toContain("execute");
});

test("no Delivery workload mounts the attestation token", () => {
  const image = `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`;
  const rendered = JSON.stringify([
    createDeliveryChart(new App(), {
      image,
      serviceItemId: "service-item",
    }).toJson(),
    createDeliveryControlPlaneChart(new App(), {
      image,
      serviceItemId: "service-item",
      executorItemId: "executor-item",
      argocdItemId: "workload-argo-item",
      workerRegistryItemId: "worker-reader-item",
      platformRegistryItemId: "platform-reader-item",
      platformArgocdItemId: "platform-argo-item",
    }).toJson(),
  ]);
  expect(rendered).not.toContain(attestor.field);
});
