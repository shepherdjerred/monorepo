import { Chart } from "cdk8s";
import type { App } from "cdk8s";
import { createStarlightKarmaBotDeployment, type Stage } from "../resources/starlight-karma-bot/index.ts";
import { Namespace } from "cdk8s-plus-31";

export function createStarlightKarmaBotChart(app: App, stage: Stage) {
  const chart = new Chart(app, `starlight-karma-bot-${stage}`, {
    namespace: `starlight-karma-bot-${stage}`,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, `starlight-karma-bot-${stage}-namespace`, {
    metadata: {
      name: `starlight-karma-bot-${stage}`,
    },
  });

  createStarlightKarmaBotDeployment(chart, stage);
}
