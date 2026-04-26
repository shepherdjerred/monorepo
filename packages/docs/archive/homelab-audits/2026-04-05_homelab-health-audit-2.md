# Homelab Health Audit — 2026-04-05 (Afternoon)

Comprehensive audit of the `torvalds` cluster using the [audit runbook](../../guides/2026-04-04_homelab-audit-runbook.md). Run with 5 parallel agents covering Talos, K8s workloads, ArgoCD/storage, monitoring/alerts, and hardware/network.

## Issues Found: 13

### Red / Critical (7)

#### 1. CPU thermal throttling — 100°C peak, ~55k throttle events/24h

- CPU hits Tjmax under sustained load; 38-43°C at idle
- Core 20 actively throttling even at rest
- **Action:** Re-paste CPU, verify cooler fan, consider cooler upgrade

#### 2. NVMe1 NAND temp peaked at 105°C

- Idle: 73°C (NVMe1) / 65°C (NVMe0). NVMe1 consistently ~8°C hotter
- Samsung 990 PRO 4TB drives
- **Action:** Add NVMe heatsinks/thermal pads, improve M.2 slot airflow

#### 3. tasknotes — CrashLoopBackOff (OOM-killed 42x)

- **Root cause:** Memory limit 512Mi too tight for Bun + Sentry + 50+ OTel instrumentation packages (~500MB baseline)
- `better-sqlite3` warning is cosmetic — devDependency of `@opentelemetry/instrumentation-knex`, never loaded at runtime
- **Fix:** Memory request 128→256Mi, limit 512Mi→1Gi (`packages/homelab/.../tasknotes/index.ts`)

#### 4. starlight-karma-bot-beta — CrashLoopBackOff (40 restarts, broken 169 days)

- **Root cause:** `.dagger/src/image.ts` `buildImageHelper` hardcodes `bunx prisma db push --skip-generate` for ALL packages. starlight-karma-bot and tasknotes don't use Prisma. `--skip-generate` also removed in newer Prisma.
- **Fix:** Added `usePrisma` parameter to `buildImageHelper` (default false). CI uses `PRISMA_PACKAGES` set to pass `--use-prisma` for birmel. Removed `--skip-generate` from all locations.
- Files: `.dagger/src/image.ts`, `.dagger/src/index.ts`, `scripts/ci/src/steps/images.ts`, `packages/birmel/package.json`, `packages/birmel/.../test-setup.ts`, `packages/homelab/.../status-page/index.ts`, `packages/scout-for-lol/.../generate-test-template-db.ts`

#### 5. argocd/apps — OutOfSync + Degraded (sync to 2.0.0-893 failed 5x)

- **Root cause:** `kyverno.ts` had uncommitted change adding `.metadata.annotations`, `.spec.conversion`, `.status` to CRD ignoreDifferences (fixes perpetual OutOfSync with Kyverno 3.7.1)
- **Fix:** Commit the existing change. Unblocks root `apps` sync cascade.

#### 6. temporal-namespace-init — stuck 3.5h waiting for frontend

- **Root cause:** `props.serverService.name` resolves to `temporal-temporal-server-service` at synth time (chart prefix), but the running pod has stale env var `temporal-server-service:7233` from before the chart was set up. Root `apps` sync being stuck (issue #5) prevents temporal chart from resyncing.
- **Fix:** No code change needed — auto-fixes when issue #5 unblocks the sync cascade.

#### 7. API server error budget burn (PagerDuty #3538)

- **Root cause:** NOT stale — legitimately firing. etcd p99 latency spiking to 3+ seconds (normal ~24ms), causing 504/500 errors. 384 5xx out of 7M requests in 3d window.
- Correlated with NVMe write volume (10.1 TB/day on nvme1n1) causing I/O contention on etcd.
- **Fix:** Hardware — NVMe heatsinks + airflow. Also: apply Talos etcd `127.0.0.1` patch to eliminate DNS jitter.

### Yellow / Warning (6)

#### 8. NVMe writes: 10.1 TB/day on nvme1n1

- PagerDuty #3542. Contributing to thermal issues and etcd latency.
- **Action:** Identify write-heavy workloads (etcd, Loki, SeaweedFS)

#### 9. smartctl/NVMe metrics not reporting

- **Root cause:** Both collector DaemonSets deployed but scripts use `2>/dev/null`, silently swallowing errors.
- **Fix:** Removed `2>/dev/null` from `smartctl.ts` and `nvme-metrics.ts`. Errors will now surface in pod logs.

#### 10. Velero weekly backups — 3 of last 4 failed

- **Root cause:** Kyverno policy `prometheus-*` wildcard labels the 256GB Prometheus TSDB PVC for backup. First weekly snapshot failed, poisoning the chain. OpenEBS plugin (`openebs/velero-plugin:3.6.0`, latest) panics on subsequent attempts with `index out of range [-1]`.
- **Fix:** Changed Kyverno policy to `alertmanager-*`, `pgdata-grafana-*`, `storage-prometheus-grafana-*` (excluding TSDB). Runtime cleanup needed after deploy:

  ```bash
  kubectl delete zfsbackup -n openebs pvc-08c23bab-9a81-4206-b98a-6eac907eacb3.weekly-backup-20260316034522
  kubectl label pvc -n prometheus prometheus-prometheus-kube-prometheus-prometheus-db-prometheus-prometheus-kube-prometheus-prometheus-0 velero.io/backup-
  ```

#### 11. Cloudflare tunnel secret errors (ErrSpecSecret x86 over 17h)

- **Root cause:** ClusterTunnel CRD had `cloudflareApiToken: "cloudflare-api-token"` overriding the default key name. Actual 1Password secret field is `CLOUDFLARE_API_TOKEN` (the default). Also missing `cloudflareTunnelCredentialSecret` mapping — secret has field `credential`, not the default `CLOUDFLARE_TUNNEL_CREDENTIAL_SECRET`.
- **Fix:** Removed `cloudflareApiToken` override (uses default), added `cloudflareTunnelCredentialSecret: "credential"` (`packages/homelab/.../cloudflare-tunnel.ts`)

#### 12. kubernetes-event-exporter — 1384 restarts

- **Root cause:** NOT OOM (3m CPU / 55Mi memory). YAML syntax error in ConfigMap — `escapeHelmGoTemplate` uses `"{{"` escaping which gets JSON-escaped by cdk8s to `\"{{\"`, breaking Helm template processing. Event-exporter receives corrupted config.
- **Fix:** Created `escapeGoTemplateForJson` using backtick-based Go template strings (`` `{{` ``) which survive JSON encoding. Added resource limits (50m/64Mi requests, 100m/128Mi limits).

#### 13. Additional issues found during investigation

| Issue                                  | Root Cause                                                                             | Fix                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| postal-mariadb metrics CPU throttling  | No resource limits on mysqld-exporter sidecar                                          | Added requests 50m/64Mi, limits 200m/128Mi          |
| status-page scrape target down         | ServiceMonitor configured for `/metrics` but app has no metrics endpoint (404)         | Removed ServiceMonitor                              |
| Released PV from sentinel namespace    | Namespace deleted, PV orphaned                                                         | Deleted: `kubectl delete pv pvc-dae48583-...`       |
| etcd gRPC localhost DNS warnings       | Talos apiserver uses `--etcd-servers=https://localhost:2379`, DNS intermittently fails | Talos patch: `etcd-servers: https://127.0.0.1:2379` |
| talosctl version mismatch              | Client v1.12.5 vs server v1.12.0                                                       | Upgrade node or downgrade client                    |
| Home Assistant 39 entities unavailable | Bedroom devices (Hue bridge / Zigbee coordinator)                                      | Check bridge connectivity                           |
| kubernetes-event-exporter RBAC         | Missing permission to read ArgoCD Application resources                                | Add ClusterRole binding                             |

## What's Working Well

- **Node:** Ready, 10% CPU, 56% memory, Talos v1.12.0, kernel 6.18.1
- **ArgoCD:** 56/59 apps synced + healthy
- **ZFS:** ARC hit ratio 99.69%, no pool errors
- **PV utilization:** All volumes under 85%
- **Velero:** Daily and monthly backups fully reliable
- **Observability:** Prometheus, Grafana, Loki, Tempo, Alertmanager all operational
- **Networking:** 35 Tailscale ingress proxies all healthy, 0 restarts. All TLS certs valid (47-69 days out)
- **SATA drives:** 41-44°C, stable
- **Databases:** All PostgreSQL, MariaDB, ClickHouse instances healthy
- **Media stack:** All 11 services running
- **DaemonSets:** 13/13 all desired=current=ready
- **PagerDuty pipeline:** End-to-end alerting working correctly

## Code Changes Summary

14 files modified:

| File                                                      | Change                                            |
| --------------------------------------------------------- | ------------------------------------------------- |
| `packages/homelab/.../tasknotes/index.ts`                 | Memory 256Mi/1Gi                                  |
| `.dagger/src/image.ts`                                    | `usePrisma` param, removed `--skip-generate`      |
| `.dagger/src/index.ts`                                    | `usePrisma` param on Dagger functions             |
| `scripts/ci/src/steps/images.ts`                          | Pass `--use-prisma` for `PRISMA_PACKAGES`         |
| `packages/birmel/package.json`                            | Removed `--skip-generate`                         |
| `packages/birmel/.../test-setup.ts`                       | Removed `--skip-generate`                         |
| `packages/homelab/.../status-page/index.ts`               | Removed ServiceMonitor, removed `--skip-generate` |
| `packages/scout-for-lol/.../generate-test-template-db.ts` | Removed `--skip-generate`                         |
| `packages/homelab/.../kyverno.ts`                         | ignoreDifferences for CRDs (existing change)      |
| `packages/homelab/.../kyverno-policies.ts`                | Exclude TSDB PVC from backup label                |
| `packages/homelab/.../cloudflare-tunnel.ts`               | Fix secret field mappings                         |
| `packages/homelab/.../kubernetes-event-exporter.ts`       | JSON-safe Helm escaping, resource limits          |
| `packages/homelab/.../postal-mariadb.ts`                  | Metrics sidecar resource limits                   |
| `packages/homelab/.../smartctl.ts`                        | Removed `2>/dev/null`                             |
| `packages/homelab/.../nvme-metrics.ts`                    | Removed `2>/dev/null`                             |

## Post-Deploy Manual Actions

1. **Velero chain cleanup:**

   ```bash
   kubectl delete zfsbackup -n openebs pvc-08c23bab-9a81-4206-b98a-6eac907eacb3.weekly-backup-20260316034522
   kubectl label pvc -n prometheus prometheus-prometheus-kube-prometheus-prometheus-db-prometheus-prometheus-kube-prometheus-prometheus-0 velero.io/backup-
   ```

2. **Talos etcd patch:**

   ```bash
   talosctl patch machineconfig --patch-file <(cat <<'EOF'
   cluster:
     apiServer:
       extraArgs:
         etcd-servers: https://127.0.0.1:2379
   EOF
   )
   ```

3. **Hardware:** NVMe heatsinks (priority: NVMe1), CPU cooler re-paste/upgrade, case airflow check
