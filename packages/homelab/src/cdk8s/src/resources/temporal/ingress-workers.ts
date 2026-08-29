import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue, type ISecret, Pods } from "cdk8s-plus-31";
import { createTemporalDomainWorker } from "./domain-worker.ts";
import { sleepWebhookEnv } from "./http-services.ts";
import { temporalRuntimeEnv } from "./runtime-env.ts";
import { createTemporalWorkerHttpServices } from "./worker-http-services.ts";

export function createTemporalIngressWorkers(
  chart: Chart,
  props: { serverServiceName: string; secret: ISecret },
) {
  const gatewayDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-gateway",
    component: "gateway",
    cpuRequest: Cpu.millis(100),
    memoryRequest: Size.mebibytes(256),
    ports: [
      { number: 9466, name: "gh-webhook" },
      { number: 9467, name: "agent-tasks" },
      { number: 9468, name: "xc-webhook" },
      { number: 9469, name: "sleep-webhook" },
    ],
    envVariables: {
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "control",
        "temporal-gateway",
      ),
      GITHUB_WEBHOOK_SECRET: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "GITHUB_WEBHOOK_SECRET",
      }),
      GITHUB_WEBHOOK_PORT: EnvValue.fromValue("9466"),
      AGENT_TASK_API_PORT: EnvValue.fromValue("9467"),
      AGENT_TASK_API_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "AGENT_TASK_API_TOKEN",
      }),
      ...sleepWebhookEnv(props.secret),
      XCODE_CLOUD_WEBHOOK_PORT: EnvValue.fromValue("9468"),
      XCODE_CLOUD_WEBHOOK_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "XCODE_CLOUD_WEBHOOK_TOKEN",
      }),
      ALERTMANAGER_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
      ),
    },
  });
  createTemporalWorkerHttpServices(
    chart,
    Pods.select(chart, "temporal-gateway-http-selector", {
      labels: { component: "gateway" },
    }),
  );

  const homeDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-home-worker",
    component: "home-worker",
    cpuRequest: Cpu.millis(100),
    memoryRequest: Size.mebibytes(512),
    envVariables: {
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "home",
        "temporal-home-worker",
      ),
      HA_URL: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "HA_URL",
      }),
      HA_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "HA_TOKEN",
      }),
    },
  });

  const reportsDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-reports-worker",
    component: "reports-worker",
    cpuRequest: Cpu.millis(100),
    memoryRequest: Size.mebibytes(512),
    envVariables: {
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "reports",
        "temporal-reports-worker",
      ),
      S3_ENDPOINT: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "S3_ENDPOINT",
      }),
      S3_REGION: EnvValue.fromValue("us-east-1"),
      S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
      AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "AWS_ACCESS_KEY_ID",
      }),
      AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "AWS_SECRET_ACCESS_KEY",
      }),
      POSTAL_HOST: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "POSTAL_HOST",
      }),
      POSTAL_HOST_HEADER: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "POSTAL_HOST_HEADER",
      }),
      POSTAL_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "POSTAL_API_KEY",
      }),
      RECIPIENT_EMAIL: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "RECIPIENT_EMAIL",
      }),
      SENDER_EMAIL: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "SENDER_EMAIL",
      }),
      ALERTMANAGER_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
      ),
    },
  });

  return { gatewayDeployment, homeDeployment, reportsDeployment };
}
