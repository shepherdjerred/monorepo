import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

export function createArgoCdApp(chart: Chart) {
  createIngress(chart, "argocd-ingress", {
    namespace: "argocd",
    service: "argocd-server",
    port: 443,
    hosts: ["argocd"],
  });

  // argocd-server defaults to HTTPS-only on its single pod port (8080 with TLS
  // auto-detection). The Service exposes port 80 → 8080 which returns 307
  // redirect-to-HTTPS for plain HTTP — and cloudflared's default origin is
  // http://, producing an infinite 307 loop and breaking the CI ArgoCD health
  // check. Target HTTPS explicitly.
  //
  // `noTlsVerify: true` is a deliberate trade-off, not an oversight. argocd-server
  // generates its own self-signed cert at install time (stored in the `argocd-secret`
  // Secret, key `tls.crt`); there is no external CA to verify against, so the only
  // way to "verify" would be to pin the cert in cloudflared's trust store and
  // re-sync on every argocd reinstall. The actual auth boundary on this endpoint
  // is the ArgoCD bearer token (Authorization header) — TLS-verify would only
  // matter against an attacker that can already MITM in-cluster pod-to-pod
  // traffic between cloudflared and argocd-server, and Cilium's WireGuard mesh
  // already encrypts that path at L3. If we ever issue argocd-server a cert
  // from a real CA (cert-manager + private intermediate), revisit and remove
  // this flag.
  createCloudflareTunnelBinding(chart, "argocd-cf-tunnel", {
    serviceName: "argocd-server",
    subdomain: "argocd",
    namespace: "argocd",
    protocol: "https",
    noTlsVerify: true,
  });

  const argoCdValues: HelmValuesForChart<"argo-cd"> = {
    global: {
      domain: "argocd.tailnet-1a49.ts.net",
    },
    // Baseline requests (no limits) so ArgoCD isn't BestEffort — without them the
    // GitOps layer is first in line for eviction under memory pressure. Values
    // are 30d steady-state usage.
    controller: {
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      resources: {
        requests: {
          cpu: "250m",
          memory: "1Gi",
        },
      },
    },
    redis: {
      exporter: {
        enabled: true,
      },
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      resources: {
        requests: {
          cpu: "25m",
          memory: "64Mi",
        },
      },
    },
    server: {
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
        },
      },
      resources: {
        requests: {
          cpu: "50m",
          memory: "256Mi",
        },
      },
    },
    applicationSet: {
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      resources: {
        requests: {
          cpu: "25m",
          memory: "256Mi",
        },
      },
    },
    notifications: {
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      resources: {
        requests: {
          cpu: "10m",
          memory: "128Mi",
        },
      },
    },
    repoServer: {
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      resources: {
        requests: {
          cpu: "100m",
          memory: "512Mi",
        },
      },
    },
    dex: {
      resources: {
        requests: {
          cpu: "10m",
          memory: "128Mi",
        },
      },
    },
    configs: {
      cm: {
        // exec.enabled toggles the ArgoCD UI pod-terminal (kubectl exec). Kept
        // off: argocd-server is internet-reachable via the Cloudflare tunnel and
        // an enabled terminal turns an admin-credential compromise into in-pod
        // RCE. The buildkite account only has applications sync/get, not exec.
        "exec.enabled": false,
        "timeout.reconciliation": "60s",
        "statusbadge.enabled": true,
        "accounts.buildkite": "apiKey",
        "accounts.buildkite.enabled": true,
        // Exclude ephemeral Velero resources from tracking
        "resource.exclusions": `- apiGroups:
  - velero.io
  kinds:
  - Backup
  - Restore
  - PodVolumeBackup
  - PodVolumeRestore`,
      },
      rbac: {
        // Allow buildkite to sync and read the apps application
        "policy.csv":
          "p, buildkite, applications, sync, default/apps, allow\np, buildkite, applications, get, default/apps, allow",
      },
    },
  };

  return new Application(chart, "argocd-app", {
    metadata: {
      name: "argocd",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://argoproj.github.io/argo-helm/
        repoUrl: "https://argoproj.github.io/argo-helm/",
        targetRevision: versions["argo-cd"],
        chart: "argo-cd",
        helm: {
          valuesObject: argoCdValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "argocd",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
