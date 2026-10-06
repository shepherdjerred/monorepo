---
title: Homelab control-plane access
description: Authentication contracts for private administrative UIs, APIs, CLIs, and CI cache clients.
---

Private network reachability does not grant mutation authority. Browser-facing
administrative surfaces use the `operator` username and a service-specific
password from 1Password. Automation uses separate bearer or signing keys.

| Surface                      | Operator access                                       | Compatibility boundary                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flipt UI and management API  | `flipt-auth` → `basic-password`                       | Evaluation, snapshot, health, and metrics routes stay credentialless for application SDKs. The gateway accepts the operator bearer token only for the repo worker's management calls or injects it after browser authentication. |
| Prometheus UI                | `monitoring-api-auth` → `prometheus-basic-password`   | Query, discovery, health, and metrics routes stay readable. Remote write and OTLP writes require the dedicated bearer token.                                                                                                     |
| Alertmanager UI and silences | `monitoring-api-auth` → `alertmanager-basic-password` | Alert reads and existing alert ingestion stay compatible. Creating, updating, or deleting a silence requires browser Basic auth or the dedicated bearer token.                                                                   |
| Temporal UI                  | `temporal-external-auth` → `ui-basic-password`        | The UI keeps its address and service port. Only its tailnet-facing HTTP route gains Basic auth.                                                                                                                                  |
| Temporal CLI                 | `toolkit temporal …`                                  | Toolkit brokers `api-token` from `temporal-external-auth` into only the Temporal process. In-cluster workers skip credential lookup and keep the raw namespace-local gRPC service.                                               |
| SeaweedFS Filer UI           | `seaweedfs-filer-auth` → `basic-password`             | The tailnet hostname keeps its port and UI. Raw Filer HTTP and gRPC remain available only inside the SeaweedFS namespace; S3 credentials and endpoints do not change.                                                            |
| Turbo remote cache           | Existing developer dotfiles                           | Trusted local and branch builds use the `monorepo` namespace and `TURBO_REMOTE_CACHE_SIGNATURE_KEY_TRUSTED`. Pull requests use the isolated `monorepo-pull-request` namespace and `TURBO_REMOTE_CACHE_SIGNATURE_KEY_PR`.         |

The declarative boundaries live in the
[Flipt deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/flipt/index.ts),
[monitoring gateways](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts),
[Temporal external gateway](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/external-auth.ts),
[SeaweedFS application](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts),
and [CI cache policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/turbo-cache.ts).

The browser passwords do not authorize service automation. The bearer and
signing fields do not belong in browser password managers, shell history, or
command arguments.

## Related

- [Configuration layers](/explanation/homelab/configuration/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
- [Why Temporal](/explanation/temporal/overview/)
