# Homelab Ops Audit & Hardening Plan

## Context

Full-stack operations audit of the homelab Kubernetes infrastructure (`packages/homelab/`). Single Talos Linux node "torvalds" — 68 namespaces, 87 deployments, 24 statefulsets, 13 daemonsets. Uses cdk8s (TypeScript) for IaC, ArgoCD GitOps, Helm for third-party charts.

---

## Audit Scorecard

| Area                  | Score | Summary                                                                                      |
| --------------------- | ----- | -------------------------------------------------------------------------------------------- |
| Monitoring & Alerting | 9/10  | 33 ServiceMonitors, 47 PrometheusRules (140+ alerts), 10 Grafana dashboards, Loki log alerts |
| Backups               | 9/10  | 4-tier Velero (6h/daily/weekly/monthly) to R2, auto-labeling, ZFS snapshots                  |
| Secret Management     | 9/10  | 1Password Connect, no hardcoded secrets, OnePasswordItem CRDs                                |
| Image Security        | 9/10  | All 81 images pinned to SHA256 digests, Renovate automated updates                           |
| Priority Classes      | 8/10  | 3-tier system (infra 1M/service 100K/batch 1K) properly applied                              |
| Storage               | 8/10  | ZFS NVMe+SATA, CSI snapshots, Retain reclaim, volume expansion                               |
| Network Policies      | 6/10  | 15 namespaces covered, 14 uncovered                                                          |
| Resource Limits       | 5/10  | ~40 deployments have limits, ~45 have none                                                   |
| Health Probes         | 4/10  | Only 7 deployments have full probes (L+R+S), ~25 have zero                                   |
| Disaster Recovery     | 3/10  | Backups exist but no WAL archiving, no restore runbook, no testing                           |
| HA/Redundancy         | 2/10  | Every deployment is single-replica, all use Recreate strategy                                |
| Autoscaling           | 1/10  | No HPA or VPA configured                                                                     |

---

## Strengths (Do Not Touch)

- Full observability: Prometheus + Alertmanager + Grafana + Loki + Tempo
- Velero 4-tier backups with auto-calculated monitoring windows per schedule
- Kyverno auto-labels PVCs for backup eligibility
- ZFS monitoring: ARC, L2ARC, pool health, SMART, NVMe, scrub scheduling
- PagerDuty integration with severity-based routing and inhibition rules
- Blackbox exporter for static site uptime
- All images SHA256-pinned with Renovate management
- ArgoCD Delete=false on databases prevents accidental deletion
- Revision history limited to 3 (deployments) / 5 (ArgoCD apps)

---

## Phase 0: Health Probes & Resource Limits (P0)

### 0.1 Add Health Probes

7 deployments have full probes (bugsink, scout, tasknotes, sentinel, status-page, temporal-server, ha-automation). 2 have partial (mcp-gateway, temporal-ui). The rest have none.

**Gold standard reference:** `resources/bugsink/index.ts:271-286` (TCP startup+liveness+readiness)

| Deployment                  | File                                     | Port  | Probe Type                 | Notes                   |
| --------------------------- | ---------------------------------------- | ----- | -------------------------- | ----------------------- |
| birmel                      | resources/birmel/index.ts                | 4111  | TCP                        | Mastra Studio port      |
| freshrss                    | resources/freshrss.ts                    | 80    | HTTP `/i/`                 | FreshRSS default health |
| plex                        | resources/media/plex.ts                  | 32400 | TCP                        | Media server            |
| tautulli                    | resources/media/tautulli.ts              | 8181  | TCP                        | Plex stats              |
| syncthing                   | resources/syncthing.ts                   | 8384  | HTTP `/rest/noauth/health` | File sync               |
| homeassistant               | resources/home/homeassistant.ts          | 8123  | TCP                        | Returns 401 = alive     |
| redlib                      | resources/frontends/redlib.ts            | 8080  | TCP                        | Reddit proxy            |
| sonarr                      | resources/torrents/sonarr.ts             | 8989  | HTTP `/ping`               | LinuxServer \*arr       |
| radarr                      | resources/torrents/radarr.ts             | 7878  | HTTP `/ping`               | LinuxServer \*arr       |
| prowlarr                    | resources/torrents/prowlarr.ts           | 9696  | HTTP `/ping`               | LinuxServer \*arr       |
| bazarr                      | resources/torrents/bazarr.ts             | 6767  | TCP                        | LinuxServer             |
| overseerr                   | resources/torrents/overseerr.ts          | 5055  | TCP                        | Request management      |
| maintainerr                 | resources/torrents/maintainerr.ts        | 6246  | TCP                        | Media pruning           |
| qbittorrent                 | resources/torrents/qbittorrent.ts        | 8080  | TCP                        | Torrent client          |
| whisperbridge               | resources/torrents/whisperbridge.ts      | 8080  | TCP                        | ASR integration         |
| postal (web)                | resources/mail/postal.ts                 | 5000  | TCP                        | Email web UI            |
| plausible                   | resources/analytics/plausible.ts         | 8000  | HTTP `/api/health`         | Analytics               |
| clickhouse                  | resources/analytics/clickhouse.ts        | 8123  | HTTP `/ping`               | Analytics DB            |
| golink                      | resources/golink.ts                      | 8080  | TCP                        | Link shortener          |
| pokemon                     | resources/pokemon.ts                     | TBD   | TCP                        | Check port in file      |
| starlight-karma-bot         | resources/starlight-karma-bot/index.ts   | TBD   | TCP                        | Check port in file      |
| better-skill-capped-fetcher | resources/better-skill-capped-fetcher.ts | N/A   | Skip                       | CronJob-like            |

**Skip probes for:** ddns (periodic updater, no HTTP port), recyclarr (cron-based, no port), gickup (periodic, no port), better-skill-capped-fetcher (CronJob).

**Also fix partial probes:**

- mcp-gateway: Add startup probe (has liveness+readiness only)
- temporal-ui: Add startup probe (has liveness+readiness only)

### 0.2 Add Resource Limits

~45 deployments have `resources: {}`. Reference pattern: `resources/torrents/sonarr.ts:77-86`.

| Deployment                     | CPU Req/Limit | Memory Req/Limit | Rationale                      |
| ------------------------------ | ------------- | ---------------- | ------------------------------ |
| birmel                         | 200m/1000m    | 256Mi/1Gi        | Discord bot + AI + SQLite      |
| golink                         | 50m/200m      | 64Mi/256Mi       | Lightweight Go service         |
| gickup                         | 100m/500m     | 128Mi/512Mi      | Periodic git operations        |
| scout (beta+prod)              | 100m/500m     | 256Mi/1Gi        | Discord bot + Riot API         |
| sentinel                       | 200m/1000m    | 256Mi/1Gi        | Webhook server + AI agents     |
| ha-automation                  | 100m/500m     | 128Mi/512Mi      | HA workflow runner             |
| status-page                    | 50m/250m      | 128Mi/512Mi      | Hono API + SQLite              |
| freshrss                       | 100m/500m     | 128Mi/512Mi      | PHP app                        |
| plex                           | 500m/4000m    | 1Gi/8Gi          | Transcoding (GPU supplemented) |
| tautulli                       | 50m/250m      | 128Mi/512Mi      | Python web app                 |
| prowlarr                       | 50m/500m      | 128Mi/512Mi      | LinuxServer indexer            |
| syncthing                      | 200m/1000m    | 256Mi/1Gi        | File sync, IO heavy            |
| redlib                         | 50m/250m      | 64Mi/256Mi       | Stateless Rust proxy           |
| pokemon                        | 500m/2000m    | 512Mi/4Gi        | GPU emulation                  |
| starlight-karma-bot            | 50m/250m      | 128Mi/512Mi      | Discord bot                    |
| recyclarr                      | 50m/250m      | 64Mi/256Mi       | Cron config updater            |
| ddns                           | 10m/100m      | 32Mi/128Mi       | Periodic DNS updater           |
| plausible                      | 100m/500m     | 256Mi/1Gi        | Elixir web app                 |
| qbittorrent (gluetun sidecar)  | 50m/500m      | 128Mi/512Mi      | VPN container has no limits    |
| qbittorrent (exporter sidecar) | 10m/100m      | 32Mi/128Mi       | Metrics exporter               |
| plex (exporter sidecar)        | 10m/100m      | 32Mi/128Mi       | Metrics exporter               |
| kubernetes-event-exporter      | 50m/200m      | 64Mi/256Mi       | Event collector                |

**Do NOT add ResourceQuotas** (known to cause etcd event storms).

### 0.3 Create `withHealthProbes()` Helper

Add to `src/cdk8s/src/misc/common.ts` alongside existing `withCommonProps()`:

```typescript
export function withHealthProbes(opts: {
  port: number;
  httpPath?: string;
  startupThreshold?: number;
}): Pick<ContainerProps, 'liveness' | 'readiness' | 'startup'> { ... }
```

TCP by default, HTTP GET if `httpPath` provided. Defaults: startup failureThreshold=30 periodSeconds=10 (5min), liveness periodSeconds=30, readiness periodSeconds=10.

---

## Phase 1: Network Security & Monitoring Gaps (P1)

### 1.1 Network Policies for Uncovered Namespaces

14 namespaces lack network policies. Follow bugsink pattern (`resources/bugsink/index.ts:365-445`).

| Namespace                   | Ingress From                                 | Egress To                     | Priority |
| --------------------------- | -------------------------------------------- | ----------------------------- | -------- |
| golink                      | Tailscale                                    | DNS only                      | High     |
| freshrss                    | Tailscale + CF tunnel                        | DNS + external feeds (80/443) | High     |
| gickup                      | (none)                                       | GitHub/GitLab + DNS           | High     |
| home (HA+automation)        | Tailscale + CF tunnel + LAN (192.168.1.0/24) | IoT + DNS + Sentry            | High     |
| tasknotes                   | Tailscale                                    | DNS + external HTTPS          | Medium   |
| scout-beta/prod             | Prometheus                                   | Riot API + Discord + S3 + DNS | Medium   |
| starlight-karma-bot         | (none)                                       | Discord + DNS                 | Medium   |
| redlib                      | Tailscale                                    | Reddit + DNS                  | Medium   |
| pokemon                     | Tailscale + CF tunnel                        | DNS                           | Low      |
| temporal                    | Tailscale (gRPC) + intra-ns                  | PostgreSQL + DNS              | Medium   |
| s3-static-sites             | CF tunnel                                    | S3 backends + DNS             | Low      |
| better-skill-capped-fetcher | (none)                                       | External HTTPS + DNS          | Low      |
| grafana-db                  | Prometheus namespace                         | (none)                        | Low      |

### 1.2 Missing ServiceMonitors

Only 9 custom ServiceMonitors exist. 24+ deployments with metrics capability lack scraping.

**Priority additions:**

- temporal-server (port 9090, `/metrics`) — already exposes metrics port
- clickhouse (native metrics) — needed for Plausible health
- tautulli — Plex monitoring data

### 1.3 Missing PrometheusRules

Current 21 rule files are excellent for infrastructure. Gaps in application-level alerting:

| Gap                        | Priority | Notes                                                |
| -------------------------- | -------- | ---------------------------------------------------- |
| PostgreSQL Operator health | P0       | Critical: connection counts, replication lag, vacuum |
| Temporal workflow failures | P1       | Workflow execution errors, stuck workflows           |
| cert-manager renewal       | P1       | Certificate expiration alerts                        |
| Kyverno policy violations  | P2       | Silent failures currently                            |
| Absent scrape target       | P2       | If a ServiceMonitor target disappears                |
| Per-PVC disk usage         | P2       | Beyond ZFS pool-level alerts                         |

### 1.4 Alertmanager Failover

Currently only PagerDuty. If PD is down, all alerts are lost. Add a fallback receiver (Slack or email via Postal).

---

## Phase 2: Backup & DR Hardening (P2)

### 2.1 Disaster Recovery Runbook

Create `packages/homelab/docs/disaster-recovery.md`:

- RTO/RPO targets per tier (infrastructure 1h/6h, service 4h/24h)
- Velero restore procedures (single namespace, full cluster)
- PostgreSQL restore (PVC snapshot, note: no PITR without WAL archiving)
- Manual bootstrap steps: Talos secrets, 1Password credentials, ZFS pool creation, ArgoCD bootstrap
- Quarterly drill schedule

### 2.2 PostgreSQL WAL Archiving

Currently NO WAL archiving. RPO = last Velero PVC snapshot (up to 6 hours of data loss).

**Fix:** Configure `archive_command` in postgres-operator for continuous WAL shipping to R2. Enables point-in-time recovery.

**Affected databases:** bugsink-postgresql, grafana-postgresql, plausible-postgresql, temporal-postgresql.

### 2.3 Database Password Backup

postgres-operator auto-generates passwords into K8s secrets. After total cluster loss + Velero restore, these secrets may not match the database. Either:

- Store generated passwords in 1Password (recommended)
- Or document re-generation procedure

### 2.4 Orphaned PV Cleanup

`pgdata-windmill-postgresql-0` is in Released state (windmill was removed). Investigate and delete.

---

## Phase 3: Long-Term Hardening (P3)

### 3.1 Tracing Coverage

Tempo deployed but only Dagger sends traces. No application-level OTLP instrumentation.

**Add OTLP env vars to Node.js apps:**

```typescript
OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue("http://tempo.tempo.svc.cluster.local:4318"),
OTEL_SERVICE_NAME: EnvValue.fromValue("scout"),
```

Priority apps: scout, tasknotes, status-page, sentinel, birmel, mcp-gateway.

### 3.2 PodDisruptionBudgets

Currently 0 PDBs found in cdk8s code (the 9 from live cluster are all from Helm charts). Single-node cluster reduces urgency, but PDBs protect during rolling updates and `kubectl drain`.

Add for: ArgoCD (Helm values), Prometheus/Alertmanager (Helm values), Home Assistant, Temporal.

### 3.3 Kyverno Policy Expansion

Currently only 1 policy (Velero PVC labeling). Add:

- Require resource requests/limits on all pods
- Require security context
- Enforce allowed image registries
- Prevent privileged escalation outside justified namespaces

### 3.4 Missing Grafana Dashboards

Have 10 dashboards. Missing:

- PostgreSQL operator health
- Temporal workflow visualization
- Loki log volume/ingestion rate
- Cert-manager certificate status

### 3.5 Storage Capacity Monitoring

No alerts for ZFS pool approaching full. Only fragmentation alerts exist. Add pool capacity alerts at 80%/90% thresholds.

---

## Full Audit Matrix

### CDK8s-Managed Deployments

| Deployment          | Probes | Resources | SvcMon  | NetPol | Backup | SecCtx        |
| ------------------- | ------ | --------- | ------- | ------ | ------ | ------------- |
| bugsink             | L+R+S  | Y         | -       | Y      | Y      | nonRoot, noPE |
| tasknotes           | L+R+S  | Y         | Y       | -      | Y      | writable FS   |
| scout               | L+R+S  | -         | Y       | -      | Y      | writable FS   |
| sentinel            | L+R+S  | -         | -       | Y      | Y      | writable FS   |
| status-page         | L+R+S  | -         | Y       | -      | Y      | writable FS   |
| ha-automation       | L+R+S  | -         | Y       | -      | -      | writable FS   |
| temporal-server     | L+R+S  | Y         | -       | Y      | -      | nonRoot       |
| temporal-ui         | L+R    | Y         | -       | Y      | -      | nonRoot       |
| mcp-gateway         | L+R    | Y         | -       | Y      | -      | nonRoot       |
| sonarr              | -      | Y         | -       | Y      | Y      | LS defaults   |
| radarr              | -      | Y         | -       | Y      | Y      | LS defaults   |
| bazarr              | -      | Y         | -       | Y      | Y      | LS defaults   |
| overseerr           | -      | Y         | -       | Y      | Y      | LS defaults   |
| maintainerr         | -      | Y         | -       | Y      | Y      | LS defaults   |
| qbittorrent         | -      | partial   | Y       | Y      | Y      | gluetun=priv  |
| whisperbridge       | -      | Y         | -       | Y      | -      | LS defaults   |
| postal (3 pods)     | -      | Y         | Y       | Y      | Y      | nonRoot       |
| clickhouse          | -      | Y         | -       | -      | Y      | nonRoot       |
| plausible           | -      | Y         | -       | Y      | Y      | nonRoot       |
| homeassistant       | -      | Y         | partial | -      | Y      | privileged    |
| plex                | -      | partial   | Y       | Y      | Y      | privileged    |
| tautulli            | -      | -         | -       | Y      | Y      | none          |
| birmel              | -      | -         | -       | Y      | Y      | writable FS   |
| golink              | -      | -         | -       | -      | Y      | custom user   |
| gickup              | -      | -         | Y       | -      | Y      | custom user   |
| freshrss            | -      | -         | -       | Y      | Y      | LS defaults   |
| syncthing           | -      | -         | -       | Y      | Y      | none          |
| redlib              | -      | -         | -       | -      | -      | none          |
| pokemon             | -      | GPU only  | -       | -      | Y      | LS defaults   |
| starlight-karma-bot | -      | -         | -       | -      | Y      | writable FS   |
| recyclarr           | -      | -         | -       | Y      | Y      | LS defaults   |
| ddns                | -      | -         | -       | -      | -      | LS defaults   |
| better-skill-capped | N/A    | Y         | -       | -      | -      | none          |

Legend: L=liveness, R=readiness, S=startup, Y=present, -=missing, partial=incomplete, LS=LinuxServer defaults, PE=privilege escalation

### Security Posture

| Category                 | Status                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| Images pinned to digests | All 81 images                                                    |
| RBAC                     | Minimal: 3 custom ClusterRoles (all read-only or scoped)         |
| Privileged containers    | 8 justified (HA, plex, gluetun, dagger, zfs/smart/nvme monitors) |
| hostNetwork              | homeassistant only (mDNS/HomeKit)                                |
| hostPID                  | None                                                             |
| Pod Security Labels      | Mixed: some restricted, some privileged (justified)              |
| Image signing/SBOM       | Not implemented                                                  |
| mTLS between services    | Not implemented                                                  |

### Backup Coverage

| Data Category        | Size   | Backed Up | Method                        |
| -------------------- | ------ | --------- | ----------------------------- |
| App configs (<200GB) | ~500Gi | Yes       | Velero PVC snapshots          |
| PostgreSQL databases | ~72Gi  | Yes       | Velero PVC snapshots (no WAL) |
| MariaDB (postal)     | 32Gi   | Yes       | Velero PVC snapshots          |
| Media (plex, qbt)    | 11Ti   | No        | >200GB exclusion              |
| Minecraft worlds     | 384Gi  | Varies    | Some under 200GB threshold    |
| Prometheus metrics   | 256Gi  | No        | Excluded (ephemeral)          |
| Loki logs            | 128Gi  | No        | Excluded                      |
| SeaweedFS blobs      | 256Gi  | No        | >200GB                        |
| Dagger build cache   | 1Ti    | No        | Ephemeral by design           |

---

---

## Grafana Dashboard Audit

### Existing Dashboards (8 custom)

| Dashboard      | UID                     | Status     | Coverage                                     |
| -------------- | ----------------------- | ---------- | -------------------------------------------- |
| Velero         | velero-dashboard        | Working    | Excellent - backup health, storage, duration |
| SMART/Smartctl | smartctl-dashboard      | Working    | Good - device health, temps, sectors         |
| ZFS            | zfs-dashboard           | **BROKEN** | TODO: "grafana is not creating this one"     |
| Buildkite CI   | buildkite-ci-dashboard  | Working    | Kueue queue health, resource sizing          |
| Gitckup        | gitckup-dashboard       | **BROKEN** | TODO: "grafana is not creating this one"     |
| HA Workflows   | ha-workflow-dashboard   | Working    | Workflow execution, success rate             |
| Scout for LoL  | scout-for-lol-dashboard | Working    | Discord stats, Riot API, commands            |
| TaskNotes      | tasknotes-dashboard     | Working    | Request rate, latency, task ops              |

Plus kube-prometheus-stack provides ~12 default dashboards (Node Exporter, Prometheus, CoreDNS, API Server, Kubelet, StatefulSet, Deployment, etc.)

### Broken Dashboards (P0 fix)

1. **ZFS Dashboard** - Code exists in `grafana/zfs-dashboard.ts` (~30 panels) but not provisioned. Cannot visualize ARC/L2ARC/pool performance.
2. **Gitckup Dashboard** - Code exists in `grafana/gitckup-dashboard.ts` (~15 panels) but not provisioned. Cannot track git backup health.

Both have TODO comment "grafana is not creating this one". Fix provisioning in `resources/grafana/index.ts`.

### Critical Missing Dashboards

| Dashboard        | Priority | Metrics Available             | Notes                                                |
| ---------------- | -------- | ----------------------------- | ---------------------------------------------------- |
| ArgoCD           | P0       | Yes (ServiceMonitors enabled) | App sync status, repo health, operator metrics       |
| Loki             | P0       | Yes (deployed)                | Log ingestion rate, error trends, query perf         |
| Tempo            | P0       | Yes (deployed)                | Trace ingestion, span count, service maps            |
| PostgreSQL       | P1       | Needs exporter                | 4 databases: connections, replication, vacuum, bloat |
| Cluster Overview | P1       | Yes (node-exporter)           | Capacity, workload distribution, resource allocation |
| etcd             | P1       | Yes (rules exist)             | Key metrics, operation latency, consensus            |
| Per-PVC Storage  | P1       | Partial                       | Top PVCs, growth trends, capacity warnings           |
| Temporal         | P1       | Yes (port 9090)               | Workflow execution, task queues, error rates         |

### Medium Priority Missing Dashboards

| Dashboard                   | Metrics Available            | Notes                                       |
| --------------------------- | ---------------------------- | ------------------------------------------- |
| Redis                       | Yes (ArgoCD enables metrics) | Memory, eviction, command latency           |
| Postal (email)              | Yes (ServiceMonitor exists)  | Delivery rates, queue depth, SMTP health    |
| Dagger CI                   | Partial                      | Pipeline execution time, cache hits         |
| Media Stack (Sonarr/Radarr) | No ServiceMonitor            | Download rates, indexer health, queue depth |
| Minecraft                   | No                           | Player count, TPS, memory                   |
| Plausible                   | No                           | Event ingestion, query performance          |
| SeaweedFS                   | No                           | File replication, write/read latency        |
| Tailscale                   | No                           | Connections, transfer, latency              |
| Cloudflare Tunnel           | No                           | Tunnel status, traffic                      |
| cert-manager                | Partial                      | Certificate renewal status, expiration      |
| Kyverno                     | No                           | Policy violations, enforcement              |
| NVMe                        | Yes (custom exporter)        | Temperature, wear, SMART trends             |
| Promtail                    | Yes                          | Log scraping success, pipeline health       |

### Monitoring Utilization

Stack deployed but only ~60% visualized. Prometheus, Loki, Tempo all collect data that has no dashboard.

---

## Version Pinning Audit

### Container Images (versions.ts)

**58 total images. All have SHA256 digests.** But:

#### 6 images using `latest` tag (should use version tags)

| Image                                 | Line    | Issue                                |
| ------------------------------------- | ------- | ------------------------------------ |
| `redlib/redlib`                       | 23-24   | `latest@sha256:...` — no version tag |
| `timothyjmiller/cloudflare-ddns`      | 56-57   | `latest@sha256:...`                  |
| `boky/postfix`                        | 176-177 | `latest@sha256:...`                  |
| `library/busybox`                     | 179-180 | `latest@sha256:...`                  |
| `library/alpine`                      | 182-183 | `latest@sha256:...`                  |
| `mccloud/bazarr-openai-whisperbridge` | 185-186 | `latest@sha256:...`                  |

Digest provides immutability, but `latest` makes debugging harder (logs show "latest" not actual version).

#### 1 image using branch tag

| Image                   | Line  | Issue                                              |
| ----------------------- | ----- | -------------------------------------------------- |
| `shepherdjerred/golink` | 62-63 | `main@sha256:...` — branch tag, not version-stable |

#### 14 images not managed by Renovate

All `shepherdjerred/*` custom images are marked `// not managed by renovate`. Updated manually via CI. Acceptable but relies on human discipline.

### Tool Versions (mise.toml) — CRITICAL

Root `.mise.toml`:

```toml
bun = "1.3.11"  # Pinned exact (GOOD)
rust = "latest"  # UNPINNED
java = "latest"  # UNPINNED
```

Homelab `mise.toml`:

```toml
bun = "latest"    # UNPINNED
python = "latest"  # UNPINNED
```

Also `packages/clauderon/rust-toolchain.toml`: `channel = "stable"` — follows latest stable Rust, not pinned.

**Fix:** Pin all to exact versions.

### NPM Dependencies — `latest` Tag (12 instances)

These are the most dangerous — will accept ANY published version:

| Package                       | Dependency           | Used In |
| ----------------------------- | -------------------- | ------- |
| scout-for-lol (6 subpackages) | `bun-types: latest`  | devDep  |
| starlight-karma-bot           | `bun-types: latest`  | devDep  |
| tasknotes-server              | `@types/bun: latest` | devDep  |
| toolkit                       | `@types/bun: latest` | devDep  |
| webring                       | `@types/bun: latest` | devDep  |
| cooklang-for-obsidian         | `obsidian: latest`   | devDep  |

### NPM Dependencies — Caret Ranges (~350+ deps)

All npm packages use `^` (caret ranges). This is standard practice but notable loose ranges:

- `typescript: "^6"` — allows 6.0.0 to 6.999.999 (across ~20 packages)
- `gray-matter: "^4"`, `prom-client: "^15"`, `yaml: "^2"` — loose major-only ranges
- `react: "^19.0.0"`, `vite: "^7.2.6"`, `eslint: "^9.x"` — framework-level ranges

**Mitigated by:** bun.lock files in 20 workspaces. Lock files provide hash-based install pinning.

### NPM Dependencies — Exact Pins (5 instances, intentional)

- `discord-player: 7.2.0` (birmel)
- `lodash: 4.18.1` (starlight-karma-bot, cdk8s)
- `pdfjs-dist: 4.10.38` (monarch)
- `react-native: 0.83.1` (tasks-for-obsidian)
- `@grafana/grafana-foundation-sdk: 11.6.0-cogv0.0.x.1769699379` (cdk8s)

### Docker Images — 1 Loose Pin

`tools/oci/Dockerfile.obsidian-headless` uses `node:22-slim` without SHA digest. All other Dockerfiles are digest-pinned.

### Terraform/OpenTofu Providers — Caret Ranges

- `cloudflare: ~> 5.0`
- `argocd: ~> 7.0`
- `onepassword: ~> 3.0`
- `github: ~> 6.0`

Standard for Terraform. Allows minor updates within major version.

### CI Tool Versions — Excellent

`.buildkite/scripts/setup-tools.sh` pins ALL 13 tools to exact versions:
ripgrep 15.1.0, kubectl v1.35.3, shellcheck 0.11.0, uv 0.11.3, helm v4.1.3, awscli 2.34.24, opentofu 1.11.5, bun 1.3.11, gh 2.89.0, rustup 1.29.0, gitleaks 8.30.1, trivy 0.69.3, semgrep 1.157.0

### Helm Chart Versions — Good

All 17 Helm charts pinned to exact semver in versions.ts. No ranges. All managed by Renovate.

### Dagger Constants — Good

All images in `.dagger/src/constants.ts` pinned to exact versions. 3 have SHA256 digests. All managed by Renovate.

### Kubernetes API Versions — Good

All using stable/non-deprecated versions (v1, apps/v1, batch/v1, networking.k8s.io/v1).

### Renovate Configuration — Good

- `pinDigests: true` for Docker images
- 30-day minimum release age
- Custom regex for versions.ts
- Critical packages (talos, kubernetes, paper) no automerge
- Schedule: Sundays after 3am

### Version Pinning Summary

| Category                       | Count               | Pinned            | Issues                             |
| ------------------------------ | ------------------- | ----------------- | ---------------------------------- |
| Container images (versions.ts) | 58                  | All digests       | 6 `latest` tag, 1 branch tag       |
| Helm charts                    | 17                  | All exact         | None                               |
| Tool versions (mise, 4 total)  | 1 exact, 3 `latest` | Partial           | rust, java, python unpinned        |
| Rust toolchain                 | 1                   | `stable`          | Not version-pinned                 |
| NPM deps (`latest`)            | 12                  | **None**          | bun-types, @types/bun, obsidian    |
| NPM deps (caret `^`)           | ~350                | Lock file         | Standard, mitigated by bun.lock    |
| NPM deps (exact)               | 5                   | Exact             | Intentional (lodash, react-native) |
| Dagger constants               | ~15                 | All exact         | None                               |
| CI tools (Buildkite)           | 13                  | All exact         | Excellent                          |
| Docker base images             | 4                   | 3 digest, 1 loose | node:22-slim lacks digest          |
| Terraform providers            | 4                   | Caret (~>)        | Standard for TF                    |
| K8s API versions               | All                 | Stable            | None                               |

---

## Key Files

All paths relative to `packages/homelab/src/cdk8s/src/`.

| File                                            | Purpose                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `misc/common.ts`                                | Add `withHealthProbes()` helper here                       |
| `resources/bugsink/index.ts`                    | Gold standard: probes, resources, netpol, security context |
| `resources/torrents/sonarr.ts`                  | LinuxServer pattern: resources, no probes                  |
| `misc/linux-server.ts`                          | LinuxServer common props                                   |
| `misc/service-monitor.ts`                       | ServiceMonitor helper                                      |
| `misc/storage-classes.ts`                       | Storage class constants                                    |
| `misc/zfs-nvme-volume.ts`                       | Auto backup label logic                                    |
| `resources/velero-schedules.ts`                 | Backup schedule definitions                                |
| `resources/monitoring/monitoring/prometheus.ts` | Alerting rules orchestrator                                |
| `resources/monitoring/monitoring/rules/`        | 21 rule group files                                        |
| `resources/kyverno-policies.ts`                 | Currently 1 policy, expand here                            |
| `resources/argo-applications/prometheus.ts`     | Alertmanager config, blackbox exporter                     |
| `resources/argo-applications/loki.ts`           | Loki ruler with 16 log alerts                              |

---

## Verification

After each phase:

1. `cd packages/homelab && bun run typecheck`
2. `cd packages/homelab && bun test`
3. `cd packages/homelab && bunx eslint . --fix`
4. `cd packages/homelab && bun run build` (cdk8s synth)
5. Commit, push, verify ArgoCD syncs
6. `kubectl get pods -A | grep -v Running` — check for CrashLoopBackOff from bad probes
7. Watch pod restarts for 10 minutes after deploy
8. For resource limits: `kubectl top pods -A` to verify limits aren't too tight
