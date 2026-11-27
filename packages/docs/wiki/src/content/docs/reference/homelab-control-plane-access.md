---
title: Homelab control-plane access
description: Authentication contracts for private administrative UIs, APIs, CLIs, and CI cache clients.
---

Private network reachability does not grant mutation authority. Browser-facing
administrative surfaces require either verified Tailscale operator identity or
the `operator` username with a service-specific password from 1Password.
Automation uses separate bearer or signing keys.

| Surface                      | Operator access                                                                  | Compatibility boundary                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags UI and management API  | Tailscale operator login (`flags.tailnet-1a49.ts.net`); `flags-auth` for machine | Port `7361` serves only `/healthz`, `/v1/deployments/:catalog/:stage/snapshot`, and `/v1/evaluate` credentiallessly to allowed consumer namespaces and rejects `Authorization`. Port `7360` requires verified Tailscale ingress proxy identity or `FLAGS_MACHINE_TOKEN`.                                      |
| Prometheus UI                | `monitoring-api-auth` → `prometheus-basic-password`                              | Query, discovery, health, and metrics routes stay readable. Remote write and OTLP writes require the dedicated bearer token.                                                                                                                                                                                  |
| Alertmanager UI and silences | `monitoring-api-auth` → `alertmanager-basic-password`                            | Alert reads and existing alert ingestion stay compatible. Creating, updating, or deleting a silence requires browser Basic auth or the dedicated bearer token.                                                                                                                                                |
| Temporal UI                  | `temporal-external-auth` → `ui-basic-password`                                   | The UI keeps its address and service port. Only its tailnet-facing HTTP route gains Basic auth.                                                                                                                                                                                                               |
| Temporal CLI                 | `toolkit temporal …`                                                             | Toolkit brokers `api-token` from `temporal-external-auth` into only the Temporal process. In-cluster workers skip credential lookup and keep the raw namespace-local gRPC service.                                                                                                                            |
| SeaweedFS Filer UI           | `seaweedfs-filer-auth` → `basic-password`                                        | The tailnet hostname keeps its port and UI. Raw Filer HTTP and gRPC remain available only inside the SeaweedFS namespace; S3 credentials and endpoints do not change.                                                                                                                                         |
| Charts console and registry  | Tailscale operator login (`charts.tailnet-1a49.ts.net`); `charts-basic-auth`     | Browser UI and JSON catalog routes require verified Tailscale ingress identity. `GET /index.yaml` and `GET /charts/*.tgz` stay readable for Argo CD and Helm; `POST /api/charts` requires Basic auth (`charts-basic-auth`).                                                                                   |
| CI cache console             | Tailscale operator login (`ci-cache.tailnet-1a49.ts.net`)                        | Browser dashboard and `/api/v1/*` inspection routes require verified Tailscale ingress identity; `/healthz`, `/readyz`, and `/metrics` remain open to in-cluster probes and Prometheus.                                                                                                                       |
| Turbo remote cache           | Existing developer dotfiles (`ci-cache.tailnet-1a49.ts.net/v8/*`)                | Requires `TURBO_TOKEN` bearer auth. [Trusted builds](#ci-cache-trust-domains) use `monorepo` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY_TRUSTED`; pull-request builds use `monorepo-pull-request` (with copy-on-write read-through from `monorepo`) and `TURBO_REMOTE_CACHE_SIGNATURE_KEY_PR`.                     |
| Gradle and sccache WebDAV    | None; CI only (`ci-cache.tailnet-1a49.ts.net/cache/` and `/sccache/`)            | [Trusted-build](#ci-cache-trust-domains) verify authenticates as `ci-main` with `GRADLE_BUILD_CACHE_WRITE_PASSWORD` (read-write). Pull-request-build verify uses `ci-pull-request` and `GRADLE_BUILD_CACHE_READ_PASSWORD` (read-only). `ci-cache` rejects writes from `ci-pull-request` and anonymous access. |

The declarative boundaries live in the
[Flags deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/flags/index.ts),
[monitoring gateways](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts),
[Temporal external gateway](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/external-auth.ts),
[SeaweedFS application](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts),
[Charts deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/charts/index.ts),
[CI cache deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/ci-cache/index.ts),
and [Turbo cache policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/turbo-cache.ts).
The Gradle and `sccache` WebDAV users are declared in
`packages/woodpecker-config-extension/src/pipeline/gradle-build-cache.ts` and
`packages/woodpecker-config-extension/src/pipeline/sccache-webdav.ts`.

The browser passwords do not authorize service automation. The bearer and
signing fields do not belong in browser password managers, shell history, or
command arguments.

## CI cache trust domains

[`cacheTrustDomain`](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/cache-trust-domain.ts)
assigns each CI build one domain from the forge-reported author, sender, and
fork flag. [Why owner pull requests are trusted](/explanation/ci-pipeline-shape/#owner-pull-requests-share-mains-build-cache).

| Build                                                                                                                   | Domain                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Push or manual run on `main`                                                                                            | Trusted                        |
| Same-repository pull request or canary benchmark; author and sender each `shepherdjerred` or `derrej`                   | Trusted                        |
| Pull request with `renovate[bot]` as author or sender                                                                   | Pull-request                   |
| Pull request or canary benchmark with `long-summer-intern[bot]` or `justin-principal-engineer[bot]` as author or sender | Pull-request                   |
| Credentialless hosted automation (Renovate before exact-head approval)                                                  | Pull-request; no cache grant   |
| Fork pull request, or any account outside the CI allowlist                                                              | Refused before any step exists |

A manual run records no sender; its author alone decides.

## Related

- [Configuration layers](/explanation/homelab/configuration/)
- [Operate feature flags and check the inventory](/how-to/check-flag-inventory/)
- [Why Temporal](/explanation/temporal/overview/)
