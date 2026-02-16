import { Chart, Size } from "cdk8s";
import { PersistentVolumeAccessMode, PersistentVolumeClaim, PersistentVolumeMode } from "cdk8s-plus-31";
import { KubeCronJob, Quantity } from "../../generated/imports/k8s.ts";
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";
import { NVME_STORAGE_CLASS } from "../misc/storage-classes.ts";
import { S3_CREDENTIALS_SECRET_NAME, S3_ENDPOINT } from "./s3-static-sites/sites.ts";
import versions from "../versions.ts";

export function createBetterSkillCappedFetcher(chart: Chart) {
  new OnePasswordItem(chart, "better-skill-capped-s3-credentials", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/vet52jaeh75chsalu6lulugium",
    },
    metadata: {
      name: S3_CREDENTIALS_SECRET_NAME,
      namespace: chart.namespace,
    },
  });

  const manifestPvc = new PersistentVolumeClaim(chart, "better-skill-capped-manifest-pvc", {
    storage: Size.gibibytes(1),
    storageClassName: NVME_STORAGE_CLASS,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_MANY],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    metadata: {
      name: "better-skill-capped-manifest",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "false",
      },
    },
  });

  new KubeCronJob(chart, "better-skill-capped-fetcher-cronjob", {
    metadata: {
      name: "better-skill-capped-fetcher",
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root": "Container runs as default user",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Container requires writable filesystem",
      },
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
                    {
                      name: "S3_BUCKET_NAME",
                      value: "better-skill-capped",
                    },
                    {
                      name: "S3_KEY",
                      value: "data/manifest.json",
                    },
                    {
                      name: "S3_ENDPOINT",
                      value: S3_ENDPOINT,
                    },
                    {
                      name: "S3_REGION",
                      value: "us-east-1",
                    },
                    {
                      name: "S3_FORCE_PATH_STYLE",
                      value: "true",
                    },
                    {
                      name: "AWS_REGION",
                      value: "us-east-1",
                    },
                    {
                      name: "AWS_ACCESS_KEY_ID",
                      valueFrom: {
                        secretKeyRef: {
                          name: S3_CREDENTIALS_SECRET_NAME,
                          key: "access_key",
                        },
                      },
                    },
                    {
                      name: "AWS_SECRET_ACCESS_KEY",
                      valueFrom: {
                        secretKeyRef: {
                          name: S3_CREDENTIALS_SECRET_NAME,
                          key: "secret_key",
                        },
                      },
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
