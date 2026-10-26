import type { Chart } from "cdk8s";
import {
  EnvValue,
  Secret,
  Service,
  type Container,
  type Deployment,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function streambotSchedulerSecret(chart: Chart) {
  const item = new OnePasswordItem(chart, "streambot-scheduler-1p", {
    metadata: { name: "streambot-scheduler" },
    spec: { itemPath: vaultItemPath("r7iu6fkj3zomdoqtgcnmbrygda") },
  });
  return Secret.fromSecretName(chart, "streambot-scheduler-secret", item.name);
}

export function createStreambotScheduling(
  chart: Chart,
  deployment: Deployment,
  container: Container,
) {
  const secret = streambotSchedulerSecret(chart);
  container.env.addVariable(
    "STREAMBOT_SCHEDULER_TOKEN",
    EnvValue.fromSecretValue({ secret, key: "password" }),
  );
  container.addPort({ number: 8081, name: "scheduler" });
  new Service(chart, "streambot-scheduler-service", {
    metadata: { name: "streambot-scheduler" },
    selector: deployment,
    ports: [{ name: "scheduler", port: 8081, targetPort: 8081 }],
  });
  new KubeNetworkPolicy(chart, "streambot-scheduler-ingress", {
    metadata: { name: "streambot-scheduler-ingress" },
    spec: {
      podSelector: { matchLabels: { app: "streambot" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { component: "streambot-worker" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8081), protocol: "TCP" }],
        },
      ],
    },
  });
}
