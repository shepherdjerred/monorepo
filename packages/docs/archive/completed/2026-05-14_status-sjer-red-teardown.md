---
id: reference-completed-2026-05-14-status-sjer-red-teardown
type: reference
status: complete
board: false
---

# status.sjer.red — full teardown

## Context

Commit `5deb85d1b` ("fix(homelab): clean up pagerduty alert sources", May 12) removed `status.sjer.red` from the static-sites list. ArgoCD has synced the change, the Probe CRD is gone from the cluster, and the prometheus-operator regenerated the scrape secret correctly. However:

1. **Operational**: the Prometheus pod (`prometheus-prometheus-kube-prometheus-prometheus-0`, single replica, 23h old) is still running a stale mounted config that contains `job_name: probe/s3-static-sites/static-site-status-sjer-red`. It keeps scraping the deleted target → blackbox returns `probe_success=0` → `StaticSiteDown` alert fires → PD incident `Q0N6K8ERQ6R94C` (#4642).
2. **Dangling DNS**: `packages/homelab/src/tofu/cloudflare/sjer-red.tf:247-263` still defines two CNAMEs (`status` and `status-api`) pointing at a Cloudflare tunnel that no longer routes them. The bucket, k8s chart, ArgoCD app, Probe, TunnelBinding, and SeaweedFS bucket resource are already removed.

Goal: resolve the in-flight alert without disrupting metrics, and finish the cleanup commit so no further references remain.

## Findings (from Phase 1 audit)

Already cleaned up (no action needed):

- `packages/homelab/src/cdk8s/src/resources/status-page/` (deleted)
- `packages/homelab/src/cdk8s/helm/status-page/` (deleted)
- `packages/homelab/src/cdk8s/src/cdk8s-charts/status-page.ts` (deleted)
- `packages/homelab/src/cdk8s/src/resources/argo-applications/status-page.ts` (deleted)
- `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts` (import + call removed)
- `scripts/ci/src/catalog.ts` (removed from `HELM_CHARTS`)
- `packages/homelab/src/tofu/seaweedfs/buckets.tf` (`status-page` bucket removed)
- `poc/status-page/` (deleted)
- `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts` (entry removed)
- Cluster state: no `Probe`, `ServiceMonitor`, `TunnelBinding`, or `Tunnel` referencing status (verified via `kubectl get probe,servicemonitor,tunnels -A`)

Still needs cleanup:

- `packages/homelab/src/tofu/cloudflare/sjer-red.tf:247-263` — two `cloudflare_dns_record` resources (`sjer_red_cname_status_api`, `sjer_red_cname_status`)
- Live Prometheus pod's mounted config secret (operational; cluster state, not repo)

## Plan

### Step 1 — Unstick the firing alert (operational, no repo change)

Single Prometheus replica, TSDB on a 256Gi `zfs-ssd` PVC (`prometheus-db-...`), so any pod restart is safe — data persists.

1. **Lowest-disruption attempt first**: annotate the operator-generated secret to bump its `resourceVersion` and prod the kubelet into reprojecting the mount:

   ```
   kubectl -n prometheus annotate secret prometheus-prometheus-kube-prometheus-prometheus \
     reloadedAt="$(date +%s)" --overwrite
   ```

   Wait 90s.

2. **Verify** the mount picked up the change:

   ```
   kubectl exec -n prometheus prometheus-prometheus-kube-prometheus-prometheus-0 -c config-reloader -- \
     /bin/sh -c 'gunzip -c /etc/prometheus/config/prometheus.yaml.gz' | grep -c static-site-status-sjer-red
   ```

   Expected: `0`. If still `1` after 90s, proceed to step 3; otherwise skip to step 4.

3. **Fallback** — force a fresh mount by deleting the pod (StatefulSet recreates it; ~20–30s scrape gap, WAL recovery a few seconds since shutdown is clean):

   ```
   kubectl -n prometheus delete pod prometheus-prometheus-kube-prometheus-prometheus-0
   ```

   Wait until `kubectl get pod -n prometheus prometheus-prometheus-kube-prometheus-prometheus-0` reports `2/2 Running`, then re-run the verification grep.

4. **Trigger reload** so Prometheus drops the old scrape pool from memory (the operator's config-reloader does this automatically after a config change, but doing it explicitly is harmless):

   ```
   kubectl -n prometheus port-forward prometheus-prometheus-kube-prometheus-prometheus-0 19090:9090 &
   curl -sf -X POST http://localhost:19090/-/reload
   ```

5. **Confirm** the scrape pool is gone and PD incident clears:

   ```
   curl -sG -H "Authorization: Bearer $GRAFANA_API_KEY" \
     --data-urlencode 'query=probe_success{site="status.sjer.red"}' \
     "$GRAFANA_URL/api/datasources/proxy/uid/prometheus/api/v1/query" | jq '.data.result'
   ```

   Expected: empty `result` array. Then `toolkit pd incidents` should no longer list `Q0N6K8ERQ6R94C`.

### Step 2 — Remove dangling DNS records

Edit `packages/homelab/src/tofu/cloudflare/sjer-red.tf`: delete lines 247-263 (both `sjer_red_cname_status_api` and `sjer_red_cname_status` resources).

Plan and apply via OpenTofu (per `packages/homelab/CLAUDE.md`):

```
op run --env-file=.env -- tofu -chdir=src/tofu/cloudflare plan
op run --env-file=.env -- tofu -chdir=src/tofu/cloudflare apply
```

Expected plan output: `2 to destroy, 0 to add, 0 to change`. State is stored in SeaweedFS (per `reference_tofu_state_seaweedfs.md`).

- Commit: `fix(homelab): remove dangling status.sjer.red DNS records`
  - Scope `homelab` per `reference_commit_msg_validation.md`.

## Out of scope

- **Alert hardening** (option 3 from the scope question). If the kubelet-stale-mount situation recurs for other removed Probes, follow up with either a checksum annotation on the Prometheus pod spec or a runbook addition — tracked separately, not in this plan.
- **PD incidents #4640 (SSD wear) and #4659 (HA entities)** — separate root causes, separate fixes.

## Critical files

- `packages/homelab/src/tofu/cloudflare/sjer-red.tf` (edit: delete lines 247-263)
- the original investigation (new log file)

## Verification

1. `kubectl exec ... gunzip /etc/prometheus/config/prometheus.yaml.gz | grep -c static-site-status-sjer-red` → `0`
2. Prometheus query `probe_success{site="status.sjer.red"}` → empty
3. `toolkit pd incidents` → `Q0N6K8ERQ6R94C` no longer listed (auto-resolves once `probe_success` series goes absent for the `for: 5m` duration)
4. `tofu plan` → `No changes` after apply
5. `dig +short status.sjer.red` and `dig +short status-api.sjer.red` → empty (or NXDOMAIN) after DNS propagation
6. `grep -rn "status\.sjer\.red\|status-page" packages/ scripts/` → no matches outside `packages/docs/`
