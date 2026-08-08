import type { Chart } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import {
  createAgentTaskApiService,
  createTemporalWorkerGithubWebhookService,
  createXcodeCloudWebhookService,
} from "./http-services.ts";

export function createTemporalWorkerHttpServices(
  chart: Chart,
  deployment: Deployment,
): void {
  createTemporalWorkerGithubWebhookService(chart, deployment);
  createAgentTaskApiService(chart, deployment);
  createXcodeCloudWebhookService(chart, deployment);
}
