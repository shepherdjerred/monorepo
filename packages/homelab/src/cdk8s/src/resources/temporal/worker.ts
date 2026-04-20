import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type CreateTemporalWorkerDeploymentProps = {
  serverServiceName: string;
};

export function createTemporalWorkerDeployment(
  chart: Chart,
  props: CreateTemporalWorkerDeploymentProps,
) {
  const UID = 1000;
  const GID = 1000;

  const onePasswordItem = new OnePasswordItem(chart, "temporal-worker-1p", {
    spec: {
      itemPath: vaultItemPath("mjgnqqh37jxyzseqrddde2jgaq"),
    },
  });
  const secret = Secret.fromSecretName(
    chart,
    "temporal-worker-secret",
    onePasswordItem.name,
  );

  const deployment = new Deployment(chart, "temporal-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    podMetadata: {
      labels: {
        app: "temporal-worker",
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: "temporal-worker",
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      securityContext: {
        user: UID,
        group: GID,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(200),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.gibibytes(1),
        },
      },
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
        // Home Assistant
        HA_URL: EnvValue.fromSecretValue({
          secret,
          key: "HA_URL",
        }),
        HA_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "HA_TOKEN",
        }),
        // S3 / SeaweedFS (for fetcher)
        S3_BUCKET_NAME: EnvValue.fromSecretValue({
          secret,
          key: "S3_BUCKET_NAME",
        }),
        S3_ENDPOINT: EnvValue.fromSecretValue({
          secret,
          key: "S3_ENDPOINT",
        }),
        S3_KEY: EnvValue.fromValue("data/manifest.json"),
        S3_REGION: EnvValue.fromValue("us-east-1"),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret,
          key: "AWS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret,
          key: "AWS_SECRET_ACCESS_KEY",
        }),
        // GitHub
        GH_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "GH_TOKEN",
        }),
        // OpenAI
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENAI_API_KEY",
        }),
        // Postal email
        POSTAL_HOST: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_HOST",
        }),
        POSTAL_HOST_HEADER: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_HOST_HEADER",
        }),
        POSTAL_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_API_KEY",
        }),
        RECIPIENT_EMAIL: EnvValue.fromSecretValue({
          secret,
          key: "RECIPIENT_EMAIL",
        }),
        SENDER_EMAIL: EnvValue.fromValue("updates@homelab.local"),
      },
    }),
  );

  void container;

  return { deployment };
}
