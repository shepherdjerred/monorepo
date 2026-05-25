# K8s Pod Status Check

## Status

Partially Complete

## Context

Checked live Kubernetes pod status for context `admin@torvalds` on May 25, 2026.

## Findings

- Node `torvalds` is `Ready` on Kubernetes `v1.36.0`, Talos `v1.13.2`, containerd `2.2.3`.
- Pod counts from `kubectl get pods -A -o json`:
  - Total pods: 347
  - Healthy running pods: 154
  - Succeeded jobs: 158
  - Unhealthy or not-ready non-succeeded pods: 35
  - Phase counts: `Failed=15`, `Pending=9`, `Running=165`, `Succeeded=158`
- Active service-impacting issues:
  - `plausible/plausible-55cbcf7bc4-6kpx2`: `CrashLoopBackOff`, 298 restarts. Logs show Postgres rejecting unencrypted connections for user `plausible` and database `plausible_db`.
  - `prometheus/prometheus-grafana-0`: Grafana container `CrashLoopBackOff`, 297 restarts. Logs show Postgres rejecting unencrypted connections for user `grafana` and database `grafana`.
  - `temporal/temporal-temporal-worker-5cdfbdd88-l688d`: `CrashLoopBackOff`, 161 restarts. Worker logs show Temporal namespace/database calls failing because the Temporal server has no usable database connection. Temporal server logs show Postgres rejecting unencrypted connections for user `temporal` and database `temporal`.
  - `scout-beta/scout-app-beta-5cf76f8b5f-9flcg` and `scout-prod/scout-app-prod-7c6867bcfd-lxxrx`: `ImagePullBackOff` for `ghcr.io/shepherdjerred/scout-app:0.0.1-dev`; prod event includes GHCR `403 Forbidden` fetching an anonymous pull token.
  - `media/kometa-29660370-rfzsw`: `CreateContainerConfigError`; event says secret `media-kometa-credentials` is missing.
- Several older `Failed` pods are stale replicas or historical failed pods from 12 days ago; they are visible in `kubectl get pods -A` but likely separate from the currently looping service failures.

## Session Log - 2026-05-25

### Done

- Loaded `kubectl-helper` before querying Kubernetes.
- Checked context, pods, node status, unhealthy pod summaries, targeted pod descriptions, and recent previous-container logs.
- Identified the main active failure classes: Postgres TLS/encryption mismatch, GHCR image pull authorization, and a missing Kometa secret.
- Implemented repo-side Postgres/TLS fixes:
  - Switched Zalando Postgres manifests from ignored `patroni.pgHba` to live CRD field `patroni.pg_hba`.
  - Changed Plausible, Grafana, and Temporal to request encrypted Postgres connections.
  - Applied the same `pg_hba` field-name fix to Bugsink.
- Verified `bun run --filter='./packages/homelab' typecheck` and `bun run --filter='./packages/homelab' test` pass.
- Verified generated manifests under `packages/homelab/src/cdk8s/dist/` contain `pg_hba`, Plausible renders `?ssl=true`, Grafana renders `ssl_mode: require`, and Temporal renders the TLS env vars.
- Confirmed `scout-frontend-beta` exists in SeaweedFS using the existing `s3-static-sites` credentials without printing secrets.
- Synced `s3-static-sites`, `scout-beta`, and `scout-prod` through ArgoCD. The stale `scout-app-*` Deployments, Services, ConfigMaps, and TunnelBindings were pruned.
- Verified Scout live endpoints:
  - `https://scout-for-lol.com/app/` -> 200
  - `https://scout-for-lol-beta.sjer.red/app/` -> 200
  - `https://scout-for-lol.com/api/healthz` -> 200
  - `https://scout-for-lol-beta.sjer.red/api/healthz` -> 200
- Verified the supplied 1Password item `gjrl6xqfupvhwnhgmjsncokiou` is in vault `v64ocnykdqju4ui6j6pua56xw4` and has a concealed field labeled `TMDB_API_KEY`, without revealing the secret value.
- Updated `packages/homelab/src/cdk8s/src/resources/media/kometa.ts` so `media-kometa-credentials` references the stable 1Password item ID instead of the name-based `kometa-credentials` lookup.
- Verified generated `packages/homelab/src/cdk8s/dist/media.k8s.yaml` renders `vaults/v64ocnykdqju4ui6j6pua56xw4/items/gjrl6xqfupvhwnhgmjsncokiou` and keeps the `TMDB_API_KEY` secret key mapping.
- Re-ran `bun run --filter='./packages/homelab' typecheck`, `bun run --filter='./packages/homelab' test`, and `cd packages/homelab && bunx eslint . --fix`; all passed.

### Remaining

- Publish the Postgres/TLS repo changes through the normal CI/ChartMuseum path, then sync `plausible`, `grafana-db`, `prometheus`, `temporal`, and `bugsink` as needed. The live apps still run the previously published chart and therefore still show Plausible/Grafana/Temporal DB connection failures.
- Publish the Kometa item-ID change through the normal CI/ChartMuseum path, then sync `media`. Live `onepassworditem/media-kometa-credentials` still references `vaults/v64ocnykdqju4ui6j6pua56xw4/items/kometa-credentials`, is not Ready, and has not created `secret/media-kometa-credentials`.
- After the chart and Kometa secret are deployed, verify the targeted pods no longer show `CrashLoopBackOff`, `ImagePullBackOff`, or `CreateContainerConfigError`.

### Caveats

- Buildkite pods were noisy because many short-lived jobs were completing while the check ran.
- Some `Failed` pods are old and may be garbage-collection/noise rather than current service failures.
- An initial parallel verification run caused a Bun install/link race; rerunning `typecheck` and `test` serially passed.
- `curl` endpoint checks required an escalated shell because sandboxed DNS resolution could not resolve the public Scout hostnames.
- The Kometa 1Password item title is `Kometa`, not `kometa-credentials`; this is acceptable because the rendered manifest now uses the stable item ID.
