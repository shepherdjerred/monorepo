import { Chart, Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import { SATA_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
export function createChartMuseumApp(chart: Chart) {
  createIngress(chart, "chartmusuem-ingress", "chartmuseum", "chartmuseum", 8080, ["chartmuseum"], true);

  createCloudflareTunnelBinding(chart, "chartmuseum-cf-tunnel", {
    serviceName: "chartmuseum",
    subdomain: "chartmuseum",
    namespace: "chartmuseum",
  });

  const basicAuth = new OnePasswordItem(chart, "chartmuseum-admin-password", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/wwoism5fsvmbisv4ef47yxqy2i",
    },
    metadata: {
      name: "chartmuseum-basic-auth",
      namespace: "chartmuseum",
    },
  });

  const chartMuseumValues: HelmValuesForChart<"chartmuseum"> = {
    persistence: {
      enabled: true,
      storageClass: SATA_STORAGE_CLASS,
      size: Size.gibibytes(8).asString(),
    },
    env: {
      open: {
        DISABLE_API: false,
        AUTH_ANONYMOUS_GET: true,
      },
      existingSecret: basicAuth.name,
      existingSecretMappings: {
        BASIC_AUTH_USER: "username",
        BASIC_AUTH_PASS: "password",
      },
    },
  };

  return new Application(chart, "chartmuseum-app", {
    metadata: {
      name: "chartmuseum",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.github.io/charts",
        targetRevision: versions.chartmuseum,
        chart: "chartmuseum",
        helm: {
          valuesObject: chartMuseumValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "chartmuseum",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
