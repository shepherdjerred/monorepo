import { Chart } from "cdk8s";
import { Deployment, DeploymentStrategy, Secret, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "../misc/common.ts";
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";
import versions from "../versions.ts";

export function createDdnsDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "ddns", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root": "Cloudflare DDNS updater runs as root",
      },
    },
  });

  const item = new OnePasswordItem(chart, "ddns-config", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/nhyb6lnjpvjsau2gkmb7n42oeq",
    },
  });

  const secret = Secret.fromSecretName(chart, "cloudflare-ddns-secret", item.name);

  deployment.addContainer(
    withCommonProps({
      image: `timothyjmiller/cloudflare-ddns:${versions["timothyjmiller/cloudflare-ddns"]}`,
      securityContext: {
        ensureNonRoot: false,
      },
      volumeMounts: [
        {
          path: "/config.json",
          subPath: "config.json",
          volume: Volume.fromSecret(chart, "cloudflare-ddns-volume", secret, {
            items: {
              "config.json": {
                path: "config.json",
              },
            },
          }),
        },
      ],
    }),
  );
}
