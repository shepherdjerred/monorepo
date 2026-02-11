import { Chart, Size } from "cdk8s";
import { ConfigMap, Deployment, DeploymentStrategy, Secret, Service, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "../misc/common.ts";
import { ZfsSataVolume } from "../misc/zfs-sata-volume.ts";
import { createServiceMonitor } from "../misc/service-monitor.ts";
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";
import versions from "../versions.ts";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createGickupDeployment(chart: Chart) {
  const UID = 65532;
  const GID = 65532;

  // Load the gickup configuration from file
  const configPath = join(CURRENT_DIRNAME, "configs", "gickup.yml");
  const configContent = await Bun.file(configPath).text();

  // Create ConfigMap for gickup configuration
  const gickupConfig = new ConfigMap(chart, "gickup-config", {
    metadata: {
      name: "gickup-config",
    },
    data: {
      "conf.yml": configContent,
    },
  });

  const deployment = new Deployment(chart, "gickup", {
    replicas: 1,
    securityContext: {
      fsGroup: GID,
    },
    strategy: DeploymentStrategy.recreate(),
  });

  const backupVolume = new ZfsSataVolume(chart, "gickup-backup-pvc", {
    storage: Size.gibibytes(256),
  });

  // Create 1Password item for GitHub token
  // Create a new item in 1Password with your GitHub personal access token
  // The token needs: repo, read:org, read:user permissions
  const githubToken = new OnePasswordItem(chart, "gickup-github-token", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/zshiow4egtiuec5n7stcskyxmm",
    },
    metadata: {
      name: "gickup-github-token",
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/cooperspencer/gickup:${versions["cooperspencer/gickup"]}`,
      ports: [{ number: 6178, name: "metrics" }],
      securityContext: {
        user: UID,
        group: GID,
      },
      volumeMounts: [
        {
          path: "/backup",
          volume: Volume.fromPersistentVolumeClaim(chart, "gickup-backup-volume", backupVolume.claim),
        },
        {
          path: "/etc/gickup",
          volume: Volume.fromConfigMap(chart, "gickup-config-volume", gickupConfig),
        },
        {
          path: "/secrets",
          volume: Volume.fromSecret(
            chart,
            "gickup-secrets-volume",
            Secret.fromSecretName(chart, "gickup-github-secret", githubToken.name),
          ),
        },
      ],
      args: ["/etc/gickup/conf.yml"],
    }),
  );

  // Create Service to expose metrics port
  new Service(chart, "gickup-service", {
    metadata: {
      name: "gickup-service",
      labels: {
        app: "gickup",
      },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 6178 }],
  });

  // Create ServiceMonitor for Prometheus to scrape gickup metrics
  createServiceMonitor(chart, { name: "gickup", interval: "60s" });
}
