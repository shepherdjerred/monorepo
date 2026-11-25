import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  MAIL_ACTIVE,
  createMailDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mail/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createMailChart(app: App, active = MAIL_ACTIVE) {
  const chart = new Chart(app, "mail", {
    namespace: "mail",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "mail-namespace", { metadata: { name: "mail" } });
  createMailDeployment(chart);
  return chart;
}
