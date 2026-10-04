import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue, type ISecret, Pods } from "cdk8s-plus-31";
import { createTemporalDomainWorker } from "./domain-worker.ts";
import { sleepWebhookEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/http-services.ts";
import { temporalRuntimeEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/runtime-env.ts";
import { createTemporalWorkerHttpServices } from "./worker-http-services.ts";

export function createTemporalIngressWorkers(
  chart: Chart,
  props: {
    serverServiceName: string;
    secret: ISecret;
    photonSecret: ISecret;
  },
) {
  const gatewayDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-gateway",
    component: "gateway",
    // The credential-owning ingress gateway is the beta consumer for durable
    // iMessage chat. Its Temporal namespace remains prod, while only the
    // feature-flag environment canaries this new ingress behavior.
    featureFlagEnvironment: "beta",
    // The namespace initializer must create prod and beta before this control
    // worker starts. Keep the gateway with the other namespace-scoped workers
    // in wave 2, after the initializer's wave 1 hook completes.
    syncWave: 2,
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
      TEMPORAL_SCHEDULE_RECONCILIATION: EnvValue.fromValue("auto"),
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
      SPECTRUM_PROJECT_ID: EnvValue.fromSecretValue({
        secret: props.photonSecret,
        key: "SPECTRUM_PROJECT_ID",
      }),
      SPECTRUM_PROJECT_SECRET: EnvValue.fromSecretValue({
        secret: props.photonSecret,
        key: "SPECTRUM_PROJECT_SECRET",
      }),
      SPECTRUM_WEBHOOK_SECRET: EnvValue.fromSecretValue({
        secret: props.photonSecret,
        key: "SPECTRUM_WEBHOOK_SECRET",
      }),
      AGENT_CHAT_DISCORD_TOKEN: EnvValue.fromSecretValue(
        {
          secret: props.secret,
          key: "AGENT_CHAT_DISCORD_TOKEN",
        },
        { optional: true },
      ),
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
  // The Discord token is optional so this Deployment can land before the
  // dedicated application credential exists. Restart the gateway when the
  // 1Password Operator later adds or rotates any referenced secret value so
  // the process observes the new environment without a manual rollout.
  gatewayDeployment.metadata.addAnnotation(
    "operator.1password.io/auto-restart",
    "true",
  );
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
      HA_URL: EnvValue.fromValue(
        "http://home-homeassistant-service.home.svc.cluster.local:8123",
      ),
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
      S3_ENDPOINT: EnvValue.fromValue(
        "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      ),
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
      POSTAL_HOST: EnvValue.fromValue(
        "http://postal-postal-web-service.postal.svc.cluster.local:5000",
      ),
      POSTAL_HOST_HEADER: EnvValue.fromValue("postal.tailnet-1a49.ts.net"),
      POSTAL_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "POSTAL_API_KEY",
      }),
      ALERTMANAGER_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
      ),
    },
  });

  return { gatewayDeployment, homeDeployment, reportsDeployment };
}
