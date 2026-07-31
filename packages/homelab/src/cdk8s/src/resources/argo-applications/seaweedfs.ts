import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeService,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

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
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/seaweedfs-s3-credentials",
    },
    metadata: {
      name: "seaweedfs-s3-credentials",
      namespace: "seaweedfs",
    },
  });

  // S3 API is tailnet-only (seaweedfs-s3.tailnet-1a49.ts.net). It is NOT exposed
  // on the public Cloudflare tunnel: the state bucket (homelab-tofu-state) and
  // llm-archive live on this gateway, and the only public consumer was an
  // out-of-cluster S3 client. In-cluster consumers (Caddy static sites, scout,
  // birmel, pokemon) use the in-cluster Service endpoint; public asset serving
  // (public.sjer.red) goes through the Caddy s3proxy, not this S3 API.
  //
  // All out-of-cluster S3 consumers have been migrated to the tailnet hostname:
  //   - CI deploy containers (pipeline since removed) used seaweedfs-s3.tailnet-1a49.ts.net
  //   - Operator dotfiles (~/.aws/config) use seaweedfs-s3.tailnet-1a49.ts.net
  //   - Tofu backends (homelab/src/tofu/*/backend.tf) use seaweedfs-s3.tailnet-1a49.ts.net
  //
  // Deployment note: removing this TunnelBinding triggers the Cloudflare tunnel operator's
  // finalizer to remove the ingress route from the shared tunnel. The CI pipeline provides a
  // fail-closed ordering guarantee via an explicit ArgoCD resource-deletion check
  // (wait-tunnel-binding-deletion step) that polls until this TunnelBinding returns 404 from
  // ArgoCD before the Cloudflare DNS Tofu apply runs. See scripts/ci/src/steps/argocd.ts
  // (waitForTunnelBindingDeletionStep) for the full implementation.
  createIngress(chart, "seaweedfs-s3-ingress", {
    namespace: "seaweedfs",
    service: "seaweedfs-s3",
    port: 8333,
    hosts: ["seaweedfs-s3"],
    // Anonymous "/" is a denied S3 ListBuckets (403); /status is the S3
    // gateway's unauthenticated health endpoint.
    probePath: "/status",
  });

  // ClusterIP service for Filer UI (the helm chart creates a headless service which doesn't work with Tailscale ingress)
  new KubeService(chart, "seaweedfs-filer-ui-service", {
    metadata: {
      name: "seaweedfs-filer-ui",
      namespace: "seaweedfs",
      annotations: {
        "ignore-check.kube-linter.io/dangling-service":
          "Pods are managed by SeaweedFS Helm chart",
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
  createIngress(chart, "seaweedfs-filer-ingress", {
    namespace: "seaweedfs",
    service: "seaweedfs-filer-ui",
    port: 8888,
    hosts: ["seaweedfs-filer"],
  });

  const seaweedfsValues: HelmValuesForChart<"seaweedfs"> = {
    global: {
      seaweedfs: {
        enableReplication: false,
        monitoring: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
    },
    // Baseline requests (no limits) so the storage layer isn't BestEffort —
    // without them SeaweedFS is among the first evicted under memory pressure.
    // Values are 30d steady-state usage.
    master: {
      enabled: true,
      replicas: 1,
      garbageThreshold: 0.3, // GC when 30% of volume is garbage
      // Grow volumes to 30 GiB before rolling to a new one (SeaweedFS's own
      // upstream default). The chart defaults this to 1000 MB, which capped every
      // volume at 1 GiB and forced ~1 volume *slot* per GiB of data — 360 tiny
      // volumes for only 88 GiB — so the slot count (maxVolumes below) became
      // pinned to disk size and the store twice hit "No writable volumes" (HTTP
      // 500 on every PutObject needing a fresh volume), reding all static-site CI
      // deploys. Bigger volumes decouple the slot count from disk: the same data
      // now needs a few dozen slots, governed by actual bytes, not slot count.
      volumeSizeLimitMB: 30_000,
      resources: {
        requests: {
          cpu: "25m",
          memory: "128Mi",
        },
      },
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
      resources: {
        requests: {
          cpu: "50m",
          memory: "256Mi",
        },
      },
      dataDirs: [
        {
          name: "data",
          type: "persistentVolumeClaim",
          size: Size.gibibytes(384).asString(),
          storageClass: NVME_STORAGE_CLASS,
          // Volume-slot cap. With master.volumeSizeLimitMB at 30 GiB, 88 GiB of
          // data packs into a few dozen volumes, so this is generous headroom, not
          // a disk-coupled limit — the real governor is now bytes on the 384 GiB
          // PVC, and disk fill is caught by the PVCStorageHigh alert (>90%). The
          // pre-existing ~360 one-GiB volumes stay allocated but become writable
          // up to 30 GiB, so they absorb new data instead of spawning fresh slots;
          // the count stops climbing and slowly consolidates. Slot exhaustion (the
          // failure mode that reded CI twice) is now alerted via the seaweedfs
          // PrometheusRule (SeaweedFSVolumeCreationFailing).
          maxVolumes: 500,
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
      resources: {
        requests: {
          cpu: "50m",
          memory: "512Mi",
        },
      },
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
      resources: {
        requests: {
          cpu: "100m",
          memory: "1Gi",
        },
      },
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
