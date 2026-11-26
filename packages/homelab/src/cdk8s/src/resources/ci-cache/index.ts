import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  Node,
  NodeLabelQuery,
  Secret,
} from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  nsPeer,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { CI_GRADLE_BUILD_CACHE_ITEM } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const CI_CACHE_ACTIVE = true;

const CI_CACHE_PORT = 7380;
const CI_TURBO_CACHE_ITEM_ID = "mzvcz4pqqbda75ufu7l5myd4ey";

// CI step pods are absent: they reach the CI cache over the tailnet, and their own
// Egress policy (`woodpecker-step-netpol`) opens no in-cluster path to port
// 7380. Add `woodpecker-ci` back together with that Egress rule.
const CONSUMER_NAMESPACES = [
  "tailscale",
  "delivery-worker-jobs",
  "delivery-platform-jobs",
] as const;

export function createCiCacheDeployment(chart: Chart) {
  const webService = new FirstPartyWebService(chart, "ci-cache-web-service", {
    name: "ci-cache",
    port: CI_CACHE_PORT,
    probes: { live: "/healthz", ready: "/readyz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: {
        fsGroup: 1000,
        fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
      },
    },
    data: {
      id: "ci-cache-liskov",
      storage: Size.gibibytes(1024),
      path: "/var/cache/ci-cache",
    },
    containers: () => {
      const turboItem = onePasswordSecret(
        chart,
        "ci-cache-turbo-1p",
        CI_TURBO_CACHE_ITEM_ID,
        { name: "ci-cache-turbo-secrets" },
      );
      const turboSecret = Secret.fromSecretName(
        chart,
        "ci-cache-turbo-secret",
        turboItem.name,
      );
      const gradleItem = onePasswordSecret(
        chart,
        "ci-cache-gradle-1p",
        CI_GRADLE_BUILD_CACHE_ITEM,
        { name: "ci-cache-gradle-secrets" },
      );
      const gradleSecret = Secret.fromSecretName(
        chart,
        "ci-cache-gradle-secret",
        gradleItem.name,
      );
      return {
        server: {
          image: firstPartyImageRecipe("ci-cache"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(100), limit: Cpu.millis(2000) },
            memory: {
              request: Size.mebibytes(128),
              limit: Size.mebibytes(512),
            },
          },
          envVariables: {
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(CI_CACHE_PORT)),
            CI_CACHE_DATA_DIR: EnvValue.fromValue("/var/cache/ci-cache"),
            TURBO_TOKEN: EnvValue.fromSecretValue({
              secret: turboSecret,
              key: "TURBO_TOKEN",
            }),
            GRADLE_BUILD_CACHE_WRITE_PASSWORD: EnvValue.fromSecretValue({
              secret: gradleSecret,
              key: "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
            }),
            GRADLE_BUILD_CACHE_READ_PASSWORD: EnvValue.fromSecretValue({
              secret: gradleSecret,
              key: "GRADLE_BUILD_CACHE_READ_PASSWORD",
            }),
          },
        },
      };
    },
    serviceName: "ci-cache",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "ci-cache-ingress",
          host: tailnetService("ci-cache"),
        },
      ],
    },
    policies: [
      {
        name: "ci-cache-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([CI_CACHE_PORT]),
          {
            from: CONSUMER_NAMESPACES.map((namespace) => nsPeer(namespace)),
            ports: [tcp(CI_CACHE_PORT)],
          },
        ],
        egress: [dnsEgressRule()],
      },
    ],
  });

  // Schedule co-located with CI step pods and BuildKit on liskov's NVMe ZFS pool.
  webService.deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  webService.deployment.scheduling.tolerate(ciNodeTaintedNode());

  return webService;
}
