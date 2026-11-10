import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
  restrictedContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";

export const BRAIN_PORT = 3000;
export const BRAIN_METRICS_PORT = 9090;

export function createStormBrainDeployment(chart: Chart) {
  const brainSecret = new OnePasswordItem(chart, "storm-brain-1p", {
    metadata: { name: "storm-brain-secrets" },
    spec: {
      // Dedicated `storm-brain` item. OPENAI_API_KEY is a manually
      // provisioned project key (Luna routes to OpenAI);
      // STORM_BRAIN_BEARER_TOKEN is item-local.
      itemPath: vaultItemPath("storm-brain"),
    },
  });
  const brainSecretRef = Secret.fromSecretName(
    chart,
    "storm-brain-secret-ref",
    brainSecret.name,
  );

  const deployment = new Deployment(chart, "storm-brain", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
    podMetadata: { labels: { app: "storm-brain" } },
  });
  const budget = new ZfsNvmeVolume(chart, "storm-brain-budget", {
    storage: Size.gibibytes(1),
  });
  const container = deployment.addContainer(
    withCommonProps({
      name: "storm-brain",
      image: firstPartyImageRecipe("storm-brain"),
      ports: [
        { name: "http", number: BRAIN_PORT },
        { name: "metrics", number: BRAIN_METRICS_PORT },
      ],
      envVariables: {
        PORT: EnvValue.fromValue(String(BRAIN_PORT)),
        STORM_COMPANION_BUDGET_DB: EnvValue.fromValue(
          "/data/companion-budget.db",
        ),
        METRICS_PORT: EnvValue.fromValue(String(BRAIN_METRICS_PORT)),
        STORM_BRAIN_BEARER_TOKEN: EnvValue.fromSecretValue({
          secret: brainSecretRef,
          key: "STORM_BRAIN_BEARER_TOKEN",
        }),
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: brainSecretRef,
          key: "OPENAI_API_KEY",
        }),
        ...fliptEnv({
          namespace: "storm",
          environment: "prod",
          order: ["FLIPT_URL", "FLIPT_NAMESPACE", "FLIPT_ENVIRONMENT"],
        }),
      },
      securityContext: restrictedContainer(1000),
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: {
          request: Size.mebibytes(64),
          limit: Size.mebibytes(512),
        },
      },
      ...httpProbes(BRAIN_PORT, {
        live: "/livez",
        ready: "/readyz",
        startup: { failureThreshold: 30, periodSeconds: 2 },
      }),
    }),
  );
  container.mount("/tmp", Volume.fromEmptyDir(chart, "storm-brain-tmp", "tmp"));
  container.mount(
    "/data",
    Volume.fromPersistentVolumeClaim(
      chart,
      "storm-brain-budget-volume",
      budget.claim,
    ),
  );
  setRevisionHistoryLimit(deployment, 5);

  const service = new Service(chart, "storm-brain-service", {
    metadata: { labels: { app: "storm-brain" } },
    selector: deployment,
    ports: [
      { port: BRAIN_PORT, name: "http" },
      { port: BRAIN_METRICS_PORT, name: "metrics" },
    ],
  });

  createServiceMonitor(chart, {
    name: "storm-brain",
    interval: "30s",
    port: "metrics",
  });

  return { brainSecret, deployment, service };
}
