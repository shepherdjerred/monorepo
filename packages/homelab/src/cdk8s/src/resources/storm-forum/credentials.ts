import type { Chart } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { KubeNamespace } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function createForumCredentials(
  chart: Chart,
  input: {
    namespace: string;
    secretItemId: string;
    observationItemId?: string;
  },
) {
  new KubeNamespace(chart, "namespace", {
    metadata: {
      name: input.namespace,
      labels: { "pod-security.kubernetes.io/enforce": "restricted" },
    },
  });
  const secret = new OnePasswordItem(chart, "credentials", {
    metadata: { name: "storm-forum-secrets" },
    spec: { itemPath: vaultItemPath(input.secretItemId) },
  });
  const observer =
    input.observationItemId === undefined
      ? undefined
      : new OnePasswordItem(chart, "delivery-observer", {
          metadata: { name: "storm-forum-delivery-observer" },
          spec: { itemPath: vaultItemPath(input.observationItemId) },
        });
  return { secret, observer };
}
