import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createDdnsDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "ddns", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Cloudflare DDNS updater runs as root",
      },
    },
  });

  const item = new OnePasswordItem(chart, "ddns-config", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/nhyb6lnjpvjsau2gkmb7n42oeq",
    },
  });

  const secret = Secret.fromSecretName(
    chart,
    "cloudflare-ddns-secret",
    item.name,
  );

  deployment.addContainer(
    withCommonProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
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

  // Mario Kart's public forwards serve IPv4. Keep its dynamic target separate
  // from ddns.sjer.red, whose existing AAAA records belong to other consumers.
  deployment.addContainer(
    withCommonProps({
      name: "ipv4-ddns",
      resources: {
        cpu: { request: Cpu.millis(5) },
        memory: { request: Size.mebibytes(16) },
      },
      image: `timothyjmiller/cloudflare-ddns:${versions["timothyjmiller/cloudflare-ddns"]}`,
      securityContext: {
        ensureNonRoot: true,
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: true,
      },
      envVariables: {
        CLOUDFLARE_API_TOKEN_FILE: EnvValue.fromValue("/secrets/api-token"),
        IP4_DOMAINS: EnvValue.fromValue("ipv4.ddns.sjer.red"),
        IP6_PROVIDER: EnvValue.fromValue("none"),
        PROXIED: EnvValue.fromValue("false"),
        TTL: EnvValue.fromValue("300"),
      },
      volumeMounts: [
        {
          path: "/secrets",
          volume: Volume.fromSecret(chart, "ipv4-ddns-token", secret, {
            name: "ipv4-ddns-token",
            items: { api_token: { path: "api-token" } },
          }),
          readOnly: true,
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);
}
