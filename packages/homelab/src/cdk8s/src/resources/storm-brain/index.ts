import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Capability,
  Cpu,
  Deployment,
  EnvValue,
  Probe,
  SeccompProfileType,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

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
    podMetadata: { labels: { app: "storm-brain" } },
  });
  const container = deployment.addContainer(
    withCommonProps({
      name: "storm-brain",
      image: `ghcr.io/shepherdjerred/storm-brain:${versions["shepherdjerred/storm-brain"]}`,
      ports: [
        { name: "http", number: BRAIN_PORT },
        { name: "metrics", number: BRAIN_METRICS_PORT },
      ],
      envVariables: {
        PORT: EnvValue.fromValue(String(BRAIN_PORT)),
        METRICS_PORT: EnvValue.fromValue(String(BRAIN_METRICS_PORT)),
        STORM_BRAIN_BEARER_TOKEN: EnvValue.fromSecretValue({
          secret: brainSecretRef,
          key: "STORM_BRAIN_BEARER_TOKEN",
        }),
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: brainSecretRef,
          key: "OPENAI_API_KEY",
        }),
        FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
        FLIPT_URL: EnvValue.fromValue(
          "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
        ),
        FLIPT_NAMESPACE: EnvValue.fromValue("storm"),
        FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
      startup: Probe.fromHttpGet("/livez", {
        port: BRAIN_PORT,
        failureThreshold: 30,
        periodSeconds: Duration.seconds(2),
      }),
      liveness: Probe.fromHttpGet("/livez", {
        port: BRAIN_PORT,
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: BRAIN_PORT,
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );
  container.mount("/tmp", Volume.fromEmptyDir(chart, "storm-brain-tmp", "tmp"));
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
