import { App } from "cdk8s";
import { beforeEach, expect, test } from "vitest";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { HOMELAB_R2_ITEM_ID } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";

beforeEach(resetProbeRegistry);

test("the Delivery API holds no R2 credential; operators supply the cold-start snapshot", () => {
  const rendered = JSON.stringify(
    createDeliveryChart(new App(), {
      image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
      serviceItemId: "service-item",
    }).toJson(),
  );
  expect(rendered).not.toContain("CLOUDFLARE_R2_");
  expect(rendered).not.toContain(HOMELAB_R2_ITEM_ID);
  expect(rendered).not.toContain('"delivery-cold-start"');
});
