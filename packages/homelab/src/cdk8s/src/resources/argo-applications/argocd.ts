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
    proxyClass: "medium",
    // argocd-server's in-cluster cert is self-signed (see the noTlsVerify
    // comment below) — the blackbox probe needs the same TLS-skip treatment.
    probeModule: "https_2xx_insecure",
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
    port: 443,
    // Must match the createIngress registration above — both register the
    // same backend probe, and argocd-server's self-signed cert needs the
    // TLS-skip module.
    probeModule: "https_2xx_insecure",
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
        // RCE. The buildkite account only has the release workflow's application
        // sync/get access plus root-app manifest override, not exec.
        "exec.enabled": false,
        "timeout.reconciliation": "60s",
        "statusbadge.enabled": true,
        "accounts.buildkite": "apiKey",
        "accounts.buildkite.enabled": true,
        // ArgoCD removed built-in Application CR health in 1.8. Restore the
        // documented app-of-apps check so the root app inherits child app and
        // workload health without widening the Buildkite account's RBAC.
        "resource.customizations.health.argoproj.io_Application": `hs = {}
hs.status = "Progressing"
hs.message = ""
if obj.status ~= nil then
  if obj.status.health ~= nil then
    -- ArgoCD's Lua health evaluator requires a non-nil hs.status; a health
    -- object without a .status field (e.g. a freshly-created child app) would
    -- otherwise blank it out and fall back to Unknown. Keep the "Progressing"
    -- default in that case.
    if obj.status.health.status ~= nil then
      hs.status = obj.status.health.status
    end
    if obj.status.health.message ~= nil then
      hs.message = obj.status.health.message
    end
  end
  if obj.status.sync == nil or obj.status.sync.status ~= "Synced" then
    if hs.status == "Healthy" then
      hs.status = "Progressing"
    end
    hs.message = "Application is not Synced"
  end
  local operationBlocks = false
  if obj.status.operationState ~= nil and
     obj.status.operationState.phase ~= nil and
     obj.status.operationState.phase ~= "Succeeded" then
    operationBlocks = true
    local phase = obj.status.operationState.phase
    if (phase == "Failed" or phase == "Error") and
       obj.status.operationState.syncResult ~= nil and
       obj.status.operationState.syncResult.revision ~= nil and
       obj.status.sync ~= nil and
       obj.status.sync.revision ~= nil and
       obj.status.operationState.syncResult.revision ~= obj.status.sync.revision then
      operationBlocks = false
    end
    -- A terminal failure whose application has since converged is stale too.
    -- ArgoCD never re-runs a sync for an application that is already Synced, so
    -- nothing can ever clear the recorded phase: the child would report
    -- Progressing forever and every later root health wave would block on it.
    -- Requiring both Synced and Healthy keeps a genuinely broken child blocking,
    -- because a rejected apply leaves the resource OutOfSync or Degraded.
    if (phase == "Failed" or phase == "Error") and
       obj.status.sync ~= nil and
       obj.status.sync.status == "Synced" and
       obj.status.health ~= nil and
       obj.status.health.status == "Healthy" then
      operationBlocks = false
    end
  end
  if operationBlocks then
    hs.status = "Progressing"
    hs.message = "Application operation is " .. obj.status.operationState.phase
  end
end
return hs`,
        // A newly-created cert-manager Certificate reports Ready=False with
        // reason DoesNotExist while it creates its target Secret. ArgoCD's
        // documented generic Certificate health check classifies every False
        // condition as Degraded, which terminates a sync wave during normal
        // issuance. Preserve terminal Ready failures and the separate
        // Issuing=False failure condition while letting that exact controller
        // transition remain bounded by the operation timeout.
        "resource.customizations.health.cert-manager.io_Certificate": `hs = {}
hs.status = "Progressing"
hs.message = "Waiting for certificate"
if obj.status ~= nil and obj.status.conditions ~= nil then
  local ready = nil
  local failedIssuing = nil
  for _, condition in ipairs(obj.status.conditions) do
    if condition.type == "Ready" then
      ready = condition
    elseif condition.type == "Issuing" and
           condition.status == "False" and
           condition.reason ~= "Issued" then
      failedIssuing = condition
    end
  end
  if ready ~= nil and ready.status == "True" then
    hs.status = "Healthy"
    if ready.message ~= nil then
      hs.message = ready.message
    end
    return hs
  end
  if failedIssuing ~= nil then
    hs.status = "Degraded"
    if failedIssuing.message ~= nil then
      hs.message = failedIssuing.message
    end
    return hs
  end
  if ready ~= nil then
    if ready.message ~= nil then
      hs.message = ready.message
    end
    if ready.status == "False" and ready.reason ~= "DoesNotExist" then
      hs.status = "Degraded"
    end
  end
end
return hs`,
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
        // The release step reconciles the exact child revisions published by
        // the coordinated Helm release, so it needs sync access to the same
        // project-wide Application set it can already read. Suspending
        // repository-backed child auto-sync uses a manifest override only on
        // the root app-of-apps Application.
        "policy.csv":
          "p, buildkite, applications, sync, default/*, allow\np, buildkite, applications, get, default/*, allow\np, buildkite, applications, override, default/apps, allow",
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
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
