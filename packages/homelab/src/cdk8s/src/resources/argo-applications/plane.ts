import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

const PLANE_NAMESPACE = "plane";
const PLANE_RELEASE = "plane";
const PLANE_URL = "https://plane.tailnet-1a49.ts.net";
const PLANE_SECRET_NAME = "plane-secrets";

export function createPlaneApp(chart: Chart) {
  const planeValues: HelmValuesForChart<"plane-enterprise"> = {
    planeVersion: versions["plane-enterprise-app"],
    license: {
      licenseServer: "https://prime.plane.so",
      licenseDomain: "plane.tailnet-1a49.ts.net",
    },
    ingress: {
      enabled: false,
    },
    securityContext: {
      enabled: true,
    },
    services: {
      redis: {
        local_setup: true,
        volumeSize: "1Gi",
      },
      postgres: {
        local_setup: true,
        volumeSize: "16Gi",
      },
      rabbitmq: {
        local_setup: true,
        volumeSize: "1Gi",
      },
      opensearch: {
        local_setup: false,
      },
      minio: {
        local_setup: false,
      },
      pi: {
        enabled: false,
      },
      runner: {
        enabled: false,
      },
    },
    external_secrets: {
      rabbitmq_existingSecret: PLANE_SECRET_NAME,
      pgdb_existingSecret: PLANE_SECRET_NAME,
      doc_store_existingSecret: PLANE_SECRET_NAME,
      app_env_existingSecret: PLANE_SECRET_NAME,
      live_env_existingSecret: PLANE_SECRET_NAME,
      silo_env_existingSecret: PLANE_SECRET_NAME,
    },
    env: {
      storageClass: "zfs-ssd",
      docstore_bucket: "plane-attachments",
      doc_upload_size_limit: 20_971_520,
      storage_provider: "S3",
      aws_region: "us-east-1",
      aws_s3_endpoint_url:
        "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      use_storage_proxy: true,
      web_url: PLANE_URL,
    },
  };

  return new Application(chart, "plane-app", {
    metadata: {
      name: PLANE_RELEASE,
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://helm.plane.so/",
        chart: "plane-enterprise",
        targetRevision: versions["plane-enterprise"],
        helm: {
          releaseName: PLANE_RELEASE,
          valuesObject: planeValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: PLANE_NAMESPACE,
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}

export function createPlaneInfrastructureApp(chart: Chart) {
  return new Application(chart, "plane-infrastructure-app", {
    metadata: {
      name: "plane-infrastructure",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "plane",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: PLANE_NAMESPACE,
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
