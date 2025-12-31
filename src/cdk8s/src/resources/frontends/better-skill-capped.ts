import {
  Deployment,
  DeploymentStrategy,
  Service,
  PersistentVolumeClaim,
  PersistentVolumeAccessMode,
  PersistentVolumeMode,
  Volume,
} from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { KubeCronJob, Quantity } from "../../../generated/imports/k8s.ts";
import { withCommonProps } from "../../misc/common.ts";
import versions from "../../versions.ts";
import { SSD_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import { TunnelBinding, TunnelBindingTunnelRefKind } from "../../../generated/imports/networking.cfargotunnel.com.ts";

export function createBetterSkillCappedDeployment(chart: Chart) {
  // Create a shared PVC for the manifest
  const manifestPvc = new PersistentVolumeClaim(chart, "better-skill-capped-manifest-pvc", {
    storage: Size.gibibytes(1),
    storageClassName: SSD_STORAGE_CLASS,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_MANY],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    metadata: {
      name: "better-skill-capped-manifest",
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
    },
  });

  // Create a volume from the PVC
  const manifestVolume = Volume.fromPersistentVolumeClaim(chart, "better-skill-capped-manifest-volume", manifestPvc);

  // Frontend deployment
  const deployment = new Deployment(chart, "better-skill-capped", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
  });

  // Create emptyDir volumes for nginx writable directories
  const cacheVolume = Volume.fromEmptyDir(chart, "bsc-nginx-cache", "nginx-cache");
  const runVolume = Volume.fromEmptyDir(chart, "bsc-nginx-run", "nginx-run");

  const container = deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/better-skill-capped:${versions["shepherdjerred/better-skill-capped"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        user: 101, // nginx user
        group: 101,
      },
      portNumber: 80,
      volumeMounts: [
        {
          path: "/usr/share/nginx/html/data",
          volume: manifestVolume,
        },
      ],
    }),
  );

  // Mount writable directories for nginx running as non-root
  container.mount("/var/cache/nginx", cacheVolume);
  container.mount("/var/run", runVolume);

  const service = new Service(chart, "better-skill-capped-service", {
    selector: deployment,
    ports: [{ port: 80 }],
  });

  new TunnelBinding(chart, "better-skill-capped-tunnel-binding", {
    subjects: [
      {
        name: service.name,
        spec: {
          fqdn: "better-skill-capped.com",
        },
      },
    ],
    tunnelRef: {
      kind: TunnelBindingTunnelRefKind.CLUSTER_TUNNEL,
      name: "homelab-tunnel",
    },
  });

  // Fetcher CronJob - runs every 15 minutes to fetch and update the manifest
  new KubeCronJob(chart, "better-skill-capped-fetcher-cronjob", {
    metadata: {
      name: "better-skill-capped-fetcher",
    },
    spec: {
      schedule: "*/15 * * * *",
      timeZone: "UTC",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          template: {
            spec: {
              restartPolicy: "OnFailure",
              containers: [
                {
                  name: "fetcher",
                  image: `ghcr.io/shepherdjerred/better-skill-capped-fetcher:${versions["shepherdjerred/better-skill-capped-fetcher"]}`,
                  env: [
                    {
                      name: "OUTPUT_PATH",
                      value: "/data/manifest.json",
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "manifest-data",
                      mountPath: "/data",
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("50m"),
                      memory: Quantity.fromString("128Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("200m"),
                      memory: Quantity.fromString("256Mi"),
                    },
                  },
                },
              ],
              volumes: [
                {
                  name: "manifest-data",
                  persistentVolumeClaim: {
                    claimName: manifestPvc.name,
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}
