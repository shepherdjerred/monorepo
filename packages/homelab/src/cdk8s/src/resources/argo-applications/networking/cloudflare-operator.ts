import type { Chart } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { CLOUDFLARE_TUNNEL_SECRET_NAME } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { argoApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

// 1Password item path for Cloudflare API token
const CLOUDFLARE_TUNNEL_1PASSWORD_ITEM_PATH = vaultItemPath(
  "sc5kj6xthlxmdn7k4mesdr2mju",
);

/** Objects the root renders beside the Application; the `cloudflare-operator-companion` companion chart renders the same objects under transition rendering. */
export function createCloudflareOperatorResources(chart: Chart): void {
  // Note: The cloudflare-operator-system namespace is created by the operator's
  // own Kustomize manifests. We don't create it here to avoid duplicate ownership.

  // Create the 1Password-synced secret in cloudflare-operator-system namespace
  // This is required for ClusterTunnel to authenticate with Cloudflare API
  new OnePasswordItem(chart, "cloudflare-tunnel-config-operator-system", {
    metadata: {
      name: CLOUDFLARE_TUNNEL_SECRET_NAME,
      namespace: "cloudflare-operator-system",
    },
    spec: {
      itemPath: CLOUDFLARE_TUNNEL_1PASSWORD_ITEM_PATH,
    },
  });
}

export function createCloudflareOperatorApp(chart: Chart) {
  createCloudflareOperatorResources(chart);

  return argoApplication(chart, {
    name: "cloudflare-operator",
    namespace: "cloudflare-operator-system",
    source: {
      // https://github.com/adyanth/cloudflare-operator
      repoUrl: "https://github.com/adyanth/cloudflare-operator.git",
      targetRevision: versions["adyanth/cloudflare-operator"],
      path: "config/default",
    },
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
