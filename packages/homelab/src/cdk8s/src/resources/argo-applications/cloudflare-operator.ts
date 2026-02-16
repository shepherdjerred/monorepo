import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";
import { CLOUDFLARE_TUNNEL_SECRET_NAME } from "../../misc/cloudflare-tunnel.ts";

// 1Password item path for Cloudflare API token
const CLOUDFLARE_TUNNEL_1PASSWORD_ITEM_PATH = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/sc5kj6xthlxmdn7k4mesdr2mju";

export function createCloudflareOperatorApp(chart: Chart) {
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

  return new Application(chart, "cloudflare-operator-app", {
    metadata: {
      name: "cloudflare-operator",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/adyanth/cloudflare-operator
        repoUrl: "https://github.com/adyanth/cloudflare-operator.git",
        targetRevision: versions["adyanth/cloudflare-operator"],
        path: "config/default",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "cloudflare-operator",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
