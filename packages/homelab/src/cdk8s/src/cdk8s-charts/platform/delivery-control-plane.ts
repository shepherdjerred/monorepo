import { Chart, type App } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";
import { createDeliveryWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/worker.ts";
import { createDeliveryWorkflowWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/workflow-worker.ts";
import {
  deliveryExecutorActivation,
  type DeliveryExecutorActivation,
} from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";

/** Controller ownership is separate from the applications it deploys and rolls back. */
export function createDeliveryControlPlaneChart(
  app: App,
  activation:
    DeliveryExecutorActivation | undefined = deliveryExecutorActivation(),
) {
  const chart = new Chart(app, "delivery-control-plane", {
    namespace: "temporal",
    disableResourceNameHashes: true,
  });
  if (activation === undefined) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  createDeliveryWorker(chart, activation, "temporal-temporal-server-service");
  createDeliveryWorkflowWorker(chart, "temporal-temporal-server-service");
  return chart;
}
