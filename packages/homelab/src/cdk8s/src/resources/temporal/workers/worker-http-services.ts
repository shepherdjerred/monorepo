import type { Chart } from "cdk8s";
import type { IPodSelector } from "cdk8s-plus-31";
import {
  createAgentTaskApiService,
  createSleepWebhookService,
  createTemporalWorkerGithubWebhookService,
  createXcodeCloudWebhookService,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/http-services.ts";

export function createTemporalWorkerHttpServices(
  chart: Chart,
  selector: IPodSelector,
): void {
  createTemporalWorkerGithubWebhookService(chart, selector);
  createAgentTaskApiService(chart, selector);
  createSleepWebhookService(chart, selector);
  createXcodeCloudWebhookService(chart, selector);
}
