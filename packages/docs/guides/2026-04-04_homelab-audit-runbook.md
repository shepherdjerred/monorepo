# Homelab Infrastructure Audit Runbook

Repeatable procedure for a comprehensive health audit of the `torvalds` cluster. Run periodically or when investigating issues.

## Prerequisites

All tools must be authenticated before starting:

| Tool       | Context                      | Check               |
| ---------- | ---------------------------- | ------------------- |
| `kubectl`  | `admin@torvalds`             | `kubectl get nodes` |
| `talosctl` | `torvalds`                   | `talosctl version`  |
| `argocd`   | `admin`                      | `argocd app list`   |
| `velero`   | —                            | `velero backup get` |
| `toolkit`  | Grafana + PagerDuty env vars | `toolkit gf alerts` |

## Execution Strategy

Run 5 parallel agents for speed. Each section is independent and read-only.

| Agent | Scope               | Sections |
| ----- | ------------------- | -------- |
| A     | Talos + Node        | 1        |
| B     | K8s Workloads       | 2, 3     |
| C     | ArgoCD + Storage    | 4, 5     |
| D     | Monitoring + Alerts | 6        |
| E     | Hardware + Network  | 7, 8     |

## Section 1: Talos Node Health

```bash
talosctl health                    # Overall cluster health (etcd, kubelet, API server)
talosctl get members               # Cluster membership
talosctl dmesg --tail 100          # Recent kernel messages (hardware errors, ZFS, OOM)
talosctl services                  # Talos system services status
talosctl version                   # Client/server version alignment
talosctl disks                     # Disk enumeration and health
```

Flag: client/server version mismatch, any service not running, kernel errors related to hardware or ZFS.

## Section 2: Kubernetes Cluster Health

```bash
kubectl get nodes -o wide                                    # Node status, version, IPs
kubectl top nodes                                            # CPU/memory utilization
kubectl get events -A --sort-by=.lastTimestamp | head -80    # Recent cluster events
```

Flag: node NotReady, high resource utilization (>85% memory), warning/error events.

## Section 3: All Workloads

### Pods

```bash
kubectl get pods -A | grep -v Running | grep -v Completed    # Non-healthy pods
```

Look for: CrashLoopBackOff, Error, Pending, ImagePullBackOff, high restart counts.

For any unhealthy pod:

```bash
kubectl logs <pod> -n <ns> --tail=50
kubectl describe pod <pod> -n <ns>
```

### Other resources

```bash
kubectl get deployments -A             # Replica readiness (READY vs DESIRED)
kubectl get statefulsets -A            # Replica readiness
kubectl get daemonsets -A              # Desired vs Ready mismatch
kubectl get jobs -A                    # Failed jobs
kubectl get cronjobs -A                # Suspended, stale last-schedule
kubectl get pv                         # Released, Failed PVs
kubectl get pvc -A                     # Pending, Lost PVCs
```

## Section 4: ArgoCD Health & Sync Status

```bash
argocd app list                        # Sync status + health for all apps
```

For any Degraded, OutOfSync, Missing, or Unknown apps:

```bash
argocd app get <app-name>              # Detailed status, sync errors, conditions
```

Note: OutOfSync with Healthy status and manual sync policy is normal — just means pending chart changes.

## Section 5: Storage & Backups

### ZFS Health (via Prometheus)

```bash
toolkit gf query 'zfs_pool_health'
toolkit gf query 'zfs_pool_fragmentation_ratio'
toolkit gf query 'node_zfs_arc_hits / (node_zfs_arc_hits + node_zfs_arc_misses)'   # ARC hit rate
```

### Velero Backups

```bash
velero backup get                      # Recent backup status
velero schedule get                    # Backup schedule health
```

Flag: failed backups, backup item errors, schedules not running on time.

### PV Utilization

```bash
toolkit gf query 'kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 0.85'
```

## Section 6: Monitoring Stack Health

### Firing Alerts

```bash
toolkit gf alerts                                          # Grafana alert rules
toolkit gf query 'ALERTS{alertstate="firing"}'             # All firing Prometheus alerts
toolkit pd incidents                                       # Open PagerDuty incidents
```

### Scrape Targets

```bash
toolkit gf query 'up == 0'                                 # Any scrape targets down
```

### Recent Error Logs (Loki)

```bash
toolkit gf logs '{namespace=~".+"} |= "error"' --limit 30
toolkit gf logs '{namespace=~".+"} |= "CrashLoopBackOff"' --limit 10
```

## Section 7: Hardware / Physical Health

### SMART Disk Status

```bash
toolkit gf query 'smartctl_device_smart_status'
toolkit gf query 'smartctl_device_temperature_celsius'
```

### NVMe Health

```bash
toolkit gf query 'nvme_smart_log_temperature'
toolkit gf query 'nvme_smart_log_percent_used'            # Wear level
```

### CPU Thermals

```bash
toolkit gf query 'node_hwmon_temp_celsius'
toolkit gf query 'rate(node_cpu_core_throttles_total[5m]) > 0'   # Thermal throttling
```

## Section 8: Network & Ingress

```bash
kubectl get pods -n tailscale                              # Tailscale operator health
kubectl get certificates -A                                # Cert-manager certificate status
kubectl get tailscaleingress -A                            # TailscaleIngress resources (if CRD exists)
```

Flag: expired or soon-to-expire certificates, Tailscale operator not running.

## Output Format

Compile findings into a structured report with:

| Severity             | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| **Red / Critical**   | Service down, data loss risk, immediate action needed |
| **Yellow / Warning** | Degraded but functional, action needed soon           |
| **Green / Healthy**  | Operating normally                                    |

Include for each issue:

- What is wrong (specific resource, namespace, error)
- Evidence (metric value, log snippet, event)
- Recommended action

End with a "What's Working Well" section to confirm healthy systems.

## Cross-Validation

- ArgoCD status should match actual pod status (OutOfSync app but pods running = just pending sync)
- Prometheus alerts should match observed issues (if alert fires but issue is gone, check alert duration)
- Backup recency should match schedule (if schedule says daily but last backup is 3 days old, investigate)
- PagerDuty incidents should correlate with firing alerts
