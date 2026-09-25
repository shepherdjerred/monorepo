import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { Node, NodeLabelQuery } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { WOODPECKER_PUBLIC_HOST } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import {
  CONFIG_EXTENSION_APP_LABEL,
  CONFIG_EXTENSION_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/config-extension.ts";

/**
 * The service that generates every build's pipeline.
 *
 * Woodpecker calls this before any step exists, so nothing runs without it —
 * it is not an optional extra. It is pinned to the CI node with the rest of
 * CI: the server can only reach it in-cluster, and keeping the whole CI path
 * on one node means a CI outage cannot be caused by the production node.
 *
 * It holds a read-only Woodpecker API token (to resolve the last green commit
 * on the default branch) and nothing else. It never sees a step's credentials:
 * those are Kubernetes secret references it merely names.
 */
export function createWoodpeckerConfigExtension(chart: Chart): void {
  const serverSecretRef = Secret.fromSecretName(
    chart,
    "woodpecker-extension-secret-ref",
    "woodpecker-server-credentials",
  );

  const deployment = new Deployment(chart, "woodpecker-config-extension", {
    replicas: 1,
    // A rolling second replica would be harmless, but the signing key is
    // fetched once per process and the service is idle between builds, so
    // there is nothing to gain from overlapping them.
    strategy: DeploymentStrategy.recreate(),
    podMetadata: { labels: { app: CONFIG_EXTENSION_APP_LABEL } },
  });
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  deployment.addContainer(
    withCommonProps({
      name: "woodpecker-config-extension",
      image: `ghcr.io/shepherdjerred/woodpecker-config-extension:${versions["shepherdjerred/woodpecker-config-extension"]}`,
      ports: [{ name: "http", number: CONFIG_EXTENSION_PORT }],
      envVariables: {
        WOODPECKER_URL: EnvValue.fromValue(WOODPECKER_PUBLIC_HOST),
        CI_REPO_SLUG: EnvValue.fromValue("shepherdjerred/monorepo"),
        WOODPECKER_API_TOKEN: EnvValue.fromSecretValue({
          secret: serverSecretRef,
          key: "WOODPECKER_API_TOKEN",
        }),
        PORT: EnvValue.fromValue(CONFIG_EXTENSION_PORT.toString()),
      },
      liveness: Probe.fromHttpGet("/healthz", { port: CONFIG_EXTENSION_PORT }),
      readiness: Probe.fromHttpGet("/healthz", { port: CONFIG_EXTENSION_PORT }),
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
    }),
  );
  setRevisionHistoryLimit(deployment);

  new Service(chart, "woodpecker-config-extension-service", {
    selector: deployment,
    metadata: {
      name: CONFIG_EXTENSION_APP_LABEL,
      labels: { app: CONFIG_EXTENSION_APP_LABEL },
    },
    ports: [{ port: CONFIG_EXTENSION_PORT, name: "http" }],
  });

  new KubeNetworkPolicy(chart, "woodpecker-config-extension-netpol", {
    metadata: { name: "woodpecker-config-extension-netpol" },
    spec: {
      podSelector: { matchLabels: { app: CONFIG_EXTENSION_APP_LABEL } },
      policyTypes: ["Egress", "Ingress"],
      ingress: [
        {
          // Only the server calls it, and only in-cluster. The signature check
          // is the real authorization; this is defence in depth.
          from: [
            { podSelector: { matchLabels: { app: "woodpecker-server" } } },
          ],
          ports: [
            {
              port: IntOrString.fromNumber(CONFIG_EXTENSION_PORT),
              protocol: "TCP",
            },
          ],
        },
      ],
      egress: [
        dnsEgressRule(),
        // The server's own API (to resolve the last green commit) and
        // raw.githubusercontent.com (to read the committed image digests at
        // the commit being built). Both are HTTPS on the public internet;
        // GitHub's ranges change, so a CIDR list would silently rot.
        externalHttpsEgressRule(),
      ],
    },
  });
}
