import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const BRAIN_PORT = 3000;
const BRAIN_METRICS_PORT = 9090;

/** Internal-only: the Storm game server is the brain's one client. */
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

  return new FirstPartyWebService(chart, "storm-brain-web-service", {
    name: "storm-brain",
    port: BRAIN_PORT,
    metricsPort: BRAIN_METRICS_PORT,
    probes: {
      live: "/livez",
      ready: "/readyz",
      startup: { failureThreshold: 30, periodSeconds: 2 },
    },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      securityContext: { fsGroup: 1000 },
    },
    revisionHistoryLimit: 5,
    data: {
      id: "storm-brain-budget",
      storage: Size.gibibytes(1),
      path: "/data",
      afterTmp: true,
    },
    containers: () => ({
      server: {
        image: firstPartyImageRecipe("storm-brain"),
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
      },
    }),
    policies: [
      {
        name: "storm-brain-netpol",
        selects: "app",
        ingress: [
          {
            // The Storm game server (minecraft-tsmc), the only brain client.
            from: [nsPeer("minecraft-tsmc")],
            ports: [tcp(BRAIN_PORT)],
          },
          prometheusIngressRule([BRAIN_PORT, BRAIN_METRICS_PORT]),
        ],
        egress: [
          dnsEgressRule(),
          // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
          fliptEgress(),
          // External HTTPS (OpenAI API)
          externalHttpsEgressRule(),
        ],
      },
    ],
  });
}
