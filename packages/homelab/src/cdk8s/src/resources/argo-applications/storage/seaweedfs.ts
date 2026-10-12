import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeNetworkPolicy,
  KubePersistentVolumeClaim,
  KubeService,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

const FILER_UPSTREAM_PORT = 8888;
const FILER_GATEWAY_PORT = 8889;
const FILER_AUTH_SECRET = "seaweedfs-filer-auth";
export const FILER_GATEWAY_CONFIG = `{
  admin off
  auto_https off
}

:${FILER_GATEWAY_PORT.toString()} {
  handle /health {
    respond "ok" 200
  }
  handle {
    basic_auth {
      operator {$SEAWEEDFS_FILER_BASIC_HASH}
    }
    reverse_proxy 127.0.0.1:${FILER_UPSTREAM_PORT.toString()}
  }
}
`;

export function createSeaweedfsApp(chart: Chart) {
  new Namespace(chart, "seaweedfs-namespace", {
    metadata: {
      name: "seaweedfs",
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // Adopt and expand the existing claims before changing immutable Helm claim
  // templates. Preserve their names and bindings; the root release owns quota
  // changes, while SeaweedFS continues mounting the same datasets.
  for (const [name, storage] of [
    ["data-filer-seaweedfs-filer-0", "4Gi"],
    ["data-seaweedfs-volume-0", "1Ti"],
  ] as const) {
    new KubePersistentVolumeClaim(chart, `${name}-capacity`, {
      metadata: {
        name,
        namespace: "seaweedfs",
        labels: {
          "velero.io/backup": "disabled",
          "velero.io/exclude-from-backup": "true",
        },
        annotations: {
          "argocd.argoproj.io/sync-wave": "-1",
          "argocd.argoproj.io/sync-options": "Prune=false",
        },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: NVME_STORAGE_CLASS,
        resources: { requests: { storage: Quantity.fromString(storage) } },
      },
    });
  }

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

  new OnePasswordItem(chart, "seaweedfs-filer-auth-onepassword", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/zkvjvzfvj3zzhxq5pumebqdoiu",
    },
    metadata: {
      name: FILER_AUTH_SECRET,
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
    proxyClass: "heavy",
    // Anonymous "/" is a denied S3 ListBuckets (403); /status is the S3
    // gateway's unauthenticated health endpoint.
    probePath: "/status",
  });

  // ClusterIP service for the authenticated Filer UI gateway. The Helm chart
  // creates a headless service, which does not work with Tailscale ingress.
  // The raw Filer port remains available only to SeaweedFS components in this
  // namespace, so the external hostname and UI capabilities remain unchanged.
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
          port: FILER_UPSTREAM_PORT,
          targetPort: IntOrString.fromNumber(FILER_GATEWAY_PORT),
        },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "seaweedfs-filer-netpol", {
    metadata: {
      name: "seaweedfs-filer-netpol",
      namespace: "seaweedfs",
    },
    spec: {
      podSelector: {
        matchLabels: {
          "app.kubernetes.io/component": "filer",
          "app.kubernetes.io/name": "seaweedfs",
        },
      },
      policyTypes: ["Ingress"],
      ingress: [
        {
          // SeaweedFS master, volume, S3, and Filer pods retain their existing
          // internal protocol access, including raw HTTP and gRPC.
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" },
              },
            },
          ],
        },
        {
          // Tailscale can reach only the authenticated UI gateway.
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
          ports: [
            {
              port: IntOrString.fromNumber(FILER_GATEWAY_PORT),
              protocol: "TCP",
            },
          ],
        },
        {
          // Prometheus retains metrics access and probes the public health
          // path on the same authenticated gateway used by Tailscale.
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [
            {
              port: IntOrString.fromNumber(9327),
              protocol: "TCP",
            },
            {
              port: IntOrString.fromNumber(FILER_GATEWAY_PORT),
              protocol: "TCP",
            },
          ],
        },
      ],
    },
  });

  // Tailscale ingress for Filer web UI (internal only)
  createIngress(chart, "seaweedfs-filer-ingress", {
    namespace: "seaweedfs",
    service: "seaweedfs-filer-ui",
    port: FILER_UPSTREAM_PORT,
    hosts: ["seaweedfs-filer"],
    probePath: "/health",
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
          // Keep the immutable template at its existing size while the explicit
          // root-owned claim above expands. A separate reviewed GitOps release
          // reconciles templates after verifying the unchanged PVC bindings.
          size: Size.gibibytes(512).asString(),
          storageClass: NVME_STORAGE_CLASS,
          // Volume-slot cap. With master.volumeSizeLimitMB at 30 GiB, 88 GiB of
          // data packs into a few dozen volumes, so this is generous headroom, not
          // a disk-coupled limit — the real governor is bytes on the data
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
        // The root-owned existing claim expands first; template reconciliation
        // belongs to the subsequent data-preserving GitOps release.
        size: Size.gibibytes(1).asString(),
        storageClass: NVME_STORAGE_CLASS,
      },
      logs: {
        type: "emptyDir",
      },
      sidecars: [
        {
          name: "authenticated-gateway",
          image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
          imagePullPolicy: "IfNotPresent",
          command: ["/bin/sh", "-c"],
          args: [
            'printf "%s" "$CADDY_CONFIG" > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile',
          ],
          ports: [{ name: "auth-ui", containerPort: FILER_GATEWAY_PORT }],
          env: [
            { name: "CADDY_CONFIG", value: FILER_GATEWAY_CONFIG },
            {
              name: "SEAWEEDFS_FILER_BASIC_HASH",
              valueFrom: {
                secretKeyRef: {
                  name: FILER_AUTH_SECRET,
                  key: "basic-hash",
                },
              },
            },
          ],
          volumeMounts: [{ name: "filer-gateway-tmp", mountPath: "/tmp" }],
          resources: {
            requests: { cpu: "5m", memory: "16Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            runAsNonRoot: true,
            readOnlyRootFilesystem: true,
            allowPrivilegeEscalation: false,
            privileged: false,
            capabilities: { drop: ["ALL"] },
          },
          livenessProbe: {
            httpGet: { path: "/health", port: FILER_GATEWAY_PORT },
            periodSeconds: 30,
          },
          readinessProbe: {
            httpGet: { path: "/health", port: FILER_GATEWAY_PORT },
            periodSeconds: 10,
          },
        },
      ],
      extraVolumes: `
- name: filer-gateway-tmp
  emptyDir: {}
`,
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
          enabled: true,
          prune: true,
          selfHeal: true,
        },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
