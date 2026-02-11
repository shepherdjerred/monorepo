import { Chart, Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { IntOrString, KubeService } from "../../../generated/imports/k8s.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";

export function createSeaweedfsApp(chart: Chart) {
  new Namespace(chart, "seaweedfs-namespace", {
    metadata: {
      name: "seaweedfs",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // 1Password secret for S3 credentials
  new OnePasswordItem(chart, "seaweedfs-credentials-onepassword", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/seaweedfs-s3-credentials",
    },
    metadata: {
      name: "seaweedfs-s3-credentials",
      namespace: "seaweedfs",
    },
  });

  // Tailscale ingress with funnel for S3 API (external access)
  createIngress(chart, "seaweedfs-s3-ingress", "seaweedfs", "seaweedfs-s3", 8333, ["seaweedfs-s3"], true);

  createCloudflareTunnelBinding(chart, "seaweedfs-s3-cf-tunnel", {
    serviceName: "seaweedfs-s3",
    subdomain: "seaweedfs",
    namespace: "seaweedfs",
  });

  // ClusterIP service for Filer UI (the helm chart creates a headless service which doesn't work with Tailscale ingress)
  new KubeService(chart, "seaweedfs-filer-ui-service", {
    metadata: {
      name: "seaweedfs-filer-ui",
      namespace: "seaweedfs",
      annotations: {
        "ignore-check.kube-linter.io/dangling-service": "Pods are managed by SeaweedFS Helm chart",
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "app.kubernetes.io/component": "filer",
        "app.kubernetes.io/name": "seaweedfs",
      },
      ports: [
        {
          name: "http",
          port: 8888,
          targetPort: IntOrString.fromNumber(8888),
        },
      ],
    },
  });

  // Tailscale ingress for Filer web UI (internal only)
  createIngress(chart, "seaweedfs-filer-ingress", "seaweedfs", "seaweedfs-filer-ui", 8888, ["seaweedfs-filer"], false);

  const seaweedfsValues: HelmValuesForChart<"seaweedfs"> = {
    global: {
      enableReplication: false,
      monitoring: {
        enabled: true,
        additionalLabels: {
          release: "prometheus",
        },
      },
    },
    master: {
      enabled: true,
      replicas: 1,
      garbageThreshold: 0.3, // GC when 30% of volume is garbage
      data: {
        type: "persistentVolumeClaim",
        size: Size.gibibytes(1).asString(),
        storageClass: NVME_STORAGE_CLASS,
      },
      logs: {
        type: "emptyDir",
      },
    },
    volume: {
      enabled: true,
      replicas: 1,
      dataDirs: [
        {
          name: "data",
          type: "persistentVolumeClaim",
          size: Size.gibibytes(128).asString(),
          storageClass: NVME_STORAGE_CLASS,
          maxVolumes: 0, // 0 means auto-detect
        },
      ],
      // Configure the PVC for volume data
      idx: {
        type: "persistentVolumeClaim",
        size: Size.gibibytes(50).asString(),
        storageClass: NVME_STORAGE_CLASS,
      },
      logs: {
        type: "emptyDir",
      },
    },
    filer: {
      enabled: true,
      replicas: 1,
      data: {
        type: "persistentVolumeClaim",
        size: Size.gibibytes(1).asString(),
        storageClass: NVME_STORAGE_CLASS,
      },
      logs: {
        type: "emptyDir",
      },
      // Enable S3 gateway on filer (used for internal filer operations)
      s3: {
        enabled: true,
        port: 8333,
      },
    },
    s3: {
      enabled: true,
      replicas: 1,
      enableAuth: true,
      existingConfigSecret: "seaweedfs-s3-credentials",
      logs: {
        type: "emptyDir",
      },
    },
  };

  return new Application(chart, "seaweedfs-app", {
    metadata: {
      name: "seaweedfs",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://seaweedfs.github.io/seaweedfs/helm",
        chart: "seaweedfs",
        targetRevision: versions.seaweedfs,
        helm: {
          releaseName: "seaweedfs",
          valuesObject: seaweedfsValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "seaweedfs",
      },
      syncPolicy: {
        automated: {
          prune: true,
          selfHeal: true,
        },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
