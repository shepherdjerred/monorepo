# Network Policy Gaps

8 namespaces with Tailscale ingresses currently have no network policies.

## Missing Namespaces

| Namespace | Type | Needs Ingress From | Needs Egress To |
|-----------|------|-------------------|-----------------|
| argocd | Helm (ArgoCD) | tailscale, cloudflare-tunnel | DNS, HTTPS (git repos), K8s API |
| chartmuseum | Helm | tailscale | DNS |
| loki | Helm | promtail, prometheus, tailscale | DNS, storage backend |
| minecraft-shuxin | Helm | tailscale, mc-router | DNS, HTTPS (Mojang API) |
| minecraft-sjerred | Helm | tailscale, mc-router | DNS, HTTPS (Mojang API) |
| minecraft-tsmc | Helm | tailscale, mc-router | DNS, HTTPS (Mojang API) |
| pokemon | Custom | tailscale | DNS, HTTPS |
| seaweedfs | Helm | tailscale, all namespaces (S3 clients), cloudflare-tunnel | DNS |

## Existing Pattern

Network policies are defined in `packages/homelab/src/cdk8s/src/cdk8s-charts/*.ts` as `KubeNetworkPolicy` pairs (ingress + egress). See `scout.ts`, `birmel.ts`, or `sentinel.ts` for examples.

Common ingress sources:
- `tailscale-operator` namespace (for Tailscale proxy pods)
- `cloudflare-operator-system` namespace (for CF tunnel)
- `prometheus` namespace (for metric scraping)

Common egress targets:
- DNS: `kube-dns` pods on port 53 UDP/TCP
- HTTPS: `0.0.0.0/0` port 443 (external APIs)
- Tempo: `tempo.tempo.svc.cluster.local:4318` (tracing)

## Implementation

Add `KubeNetworkPolicy` resources in each namespace's chart file following the existing pattern. Low priority since all external access already goes through Tailscale (private) or Cloudflare tunnel (protected).
