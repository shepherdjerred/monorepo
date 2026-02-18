import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  Service,
  Volume,
  EnvValue,
} from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";

export function createFreshRssDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "freshrss", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "FreshRSS requires root for PHP-FPM and cron operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "FreshRSS requires writable filesystem for sessions and cache",
      },
    },
  });

  const freshRssDataVolume = new ZfsNvmeVolume(chart, "freshrss-data", {
    storage: Size.gibibytes(32),
  });
  const freshRssExtensionsVolme = new ZfsNvmeVolume(
    chart,
    "freshrss-extensions",
    {
      storage: Size.gibibytes(8),
    },
  );

  deployment.addContainer(
    withCommonProps({
      image: `freshrss/freshrss:${versions["freshrss/freshrss"]}`,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      envVariables: {
        // Enable cron for automatic feed updates every hour
        CRON_MIN: EnvValue.fromValue("13"), // Run at minute 13 of every hour
      },
      volumeMounts: [
        {
          path: "/var/www/FreshRSS/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "freshrss-data-volume",
            freshRssDataVolume.claim,
          ),
        },
        {
          path: "/var/www/FreshRSS/extensions",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "freshrss-extensions-volume",
            freshRssExtensionsVolme.claim,
          ),
        },
      ],
    }),
  );

  const service = new Service(chart, "freshrss-service", {
    selector: deployment,
    ports: [{ port: 80 }],
  });

  new TailscaleIngress(chart, "freshrss-tailscale-ingress", {
    service,
    host: "freshrss",
    funnel: true,
  });

  createCloudflareTunnelBinding(chart, "freshrss-cf-tunnel", {
    serviceName: service.name,
    subdomain: "freshrss",
  });
}
