# Homelab Issue Investigation — 2026-05-08

Companion to [2026-05-08 Homelab Health Audit](2026-05-08_homelab-health-audit.md). Root-cause-level deep dive on every Yellow row, every open PD incident, and every notable Bugsink issue from the audit. Five investigation agents ran in parallel; this is the consolidated finding set.

**Scope:** investigate + report only. No mutations were applied to the cluster, PagerDuty, Bugsink, or git history. Every "action" below is a proposal for the user to execute.

## TL;DR

| Category                                               | Count | What's actionable                                                                                                                     |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Issues that need real code changes                     | **2** | Cluster I-Tp3 (`goodMorningEarly` 30m vs 60m sleep — structural bug) and Cluster A (one inhibit_rule line for cosmetic alert hygiene) |
| Issues that need physical / external action            | **5** | Replace Granary desiccant + batteries; plug in Sonos Roam; power-cycle Era 100 + Sonoff S31 plug; top up OpenAI billing               |
| Issues that just need PD ack/resolve                   | **2** | PD #4254 + #4255 (ZFS frag — already stale by 2026-05-05 policy)                                                                      |
| Issues already fixed in code, awaiting drain or deploy | **3** | B1 satori (commits `1e3cd4f85` + `8946b9f53`); B4 Webpack (`7659428f1`); P2 Released PV (commit `1b32bea9f` retired the workload)     |
| External / transient — no homelab change               | **3** | B3 Discord 5xx (Discord status incident); B5 better-skill-capped browser navigation race; redlib (upstream issue #551)                |
| Audit findings that turned out to be wrong             | **5** | Listed in [Audit Corrections](#audit-corrections) below                                                                               |

**Net deltas vs. the audit's 13 Major Issue Deep Dives:** 5 corrections, 2 real new fixes (one structural Temporal bug + one inhibit rule), the rest reduces to PD hygiene / physical action / external dependencies.

## Audit Corrections

The audit was correct on most items, but five claims need revision:

| Audit claim                                                                              | Reality                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NodeMemoryMajorPagesFaults` is firing **without PD coverage** (Major Issue #10)         | Already silenced. Alertmanager route to `null` receiver added in commit `fb22d3211` (2026-04-21) at `prometheus.ts:326-331`. Three custom replacements (`HighMemoryPressure`, `LowMemoryAvailable`, `MemoryLeakSuspected`) cover the same surface tighter.                                                                                                                          | `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:326-331`; `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/resource-monitoring.ts` |
| PD #4254 + #4255 (ZFS frag 61%) are **valid**, not stale                                 | Stale by policy. Thresholds raised to `>80%` warn / `>90%` crit on 2026-05-05 (commit `4b31fc276`, decision doc `2026-05-05_zfs-fragmentation-acceptance.md`). 61% < 80% → no current rule fires; the open PDs are residual incidents from 2026-05-04 fires under the old `>50%` threshold.                                                                                         | `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/zfs-maintenance.ts:17,35`; `packages/docs/decisions/2026-05-05_zfs-fragmentation-acceptance.md`             |
| Velero backup target is **SeaweedFS S3** (Major Issue #6, PD #4235 row)                  | It's **Cloudflare R2**. `s3Url: https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com`, `region: auto`. SeaweedFS is unrelated.                                                                                                                                                                                                                                         | `packages/homelab/src/cdk8s/src/resources/argo-applications/velero.ts:75-109`                                                                                                     |
| HA #4399 includes **front-door MQTT bridge** down                                        | No MQTT bridge in cluster. The single front-door entity (`siren.front_door_siren`) is owned by the Reolink Doorbell integration and reports `unknown` whenever the siren is idle — it's the integration's standard capability-state-null behavior. The Reolink config entry is `state: loaded`; all other Reolink entities for the same device are live.                            | HA config registry; `kubectl get pods -n home` (`home-eufy-security-ws` is for Eufy cameras, not Reolink)                                                                         |
| `redlib` 216 restarts → rotate `REDDIT_CLIENT_ID`/`SECRET` in 1Password (Major Issue #1) | redlib does **OAuth token spoofing** (impersonating iOS/Android Reddit apps); it does **not** accept user-supplied client credentials. No 1Password item exists or should exist. Real cause is upstream issue [redlib-org/redlib#551](https://github.com/redlib-org/redlib/issues/551) (open since 2026-04-25). Real fix is an image bump once upstream lands a fingerprint update. | `packages/homelab/src/cdk8s/src/resources/frontends/redlib.ts:21-38`; `packages/homelab/src/cdk8s/src/cdk8s-charts/redlib.ts`; repo-wide `grep REDDIT_CLIENT` returns 0 hits      |

## Cluster A — Postgres `*-critical-op-pdb` alerts (4 Yellow rows)

**Root cause confirmed.** The Zalando postgres-operator generates **two** PDBs per cluster: `postgres-<n>-postgresql-pdb` (selector `spilo-role=master`, healthy) and `postgres-<n>-postgresql-critical-op-pdb` (selector `critical-operation=true`, only labeled during failover). At steady state the critical-op selector matches 0 pods, so `KubePdbNotEnoughHealthyPods` fires permanently across `bugsink`, `plausible`, `temporal`, `prometheus` (grafana-postgresql).

**Per-Postgresql-CR opt-out is NOT supported.** `enablePodDisruptionBudget` only exists on `OperatorConfigurationConfigurationKubernetes` (`acid.zalan.do.ts:654`) and only controls the regular `*-pdb`, not the critical-op one. The `PostgresqlSpec` interface (`acid.zalan.do.ts:2002`) has `enableConnectionPooler`, `enableLogicalBackup`, `enableMasterLoadBalancer` etc. — no PDB-related flag.

**Existing PD silence is working.** The Alertmanager route at `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:332-340` already routes `KubePdbNotEnoughHealthyPods` + `poddisruptionbudget =~ ".*-critical-op-pdb"` to the `null` receiver. That's why no PD incident exists. The audit's "no PD coverage" framing implied a gap; there isn't one.

**Recommended remediation (cosmetic only):** Add an inhibit_rule so the alerts also disappear from `ALERTS{alertstate="firing"}` (cleans up the Grafana firing-alerts panel and the audit's "Distinct firing alerts" row).

```ts
// packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts (insert into inhibit_rules near :258)
{
  source_matchers: ['alertname = "Watchdog"'],
  target_matchers: [
    'alertname = "KubePdbNotEnoughHealthyPods"',
    'poddisruptionbudget =~ ".*-critical-op-pdb"',
  ],
},
```

Established homelab pattern (Watchdog as a permanent suppressor). Risk: zero — single-replica clusters on a single-node homelab don't get value from voluntary-disruption protection on the critical-op PDB.

**Files:** `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts`. Postgresql CRs at `packages/homelab/src/cdk8s/src/resources/postgres/{bugsink,plausible,temporal,grafana}-db.ts` are unchanged.

## Cluster B — `NodeMemoryMajorPagesFaults`

**Root cause: stale audit finding.** Already silenced 2026-04-21 with three custom homelab-grade memory alerts taking its place:

- `HighMemoryPressure` (warning): `(1 - MemAvail/MemTotal) > 0.9` for 10m — `resource-monitoring.ts:48`
- `LowMemoryAvailable` (critical): `MemAvailable < 1 GiB` for 5m — `resource-monitoring.ts:62`
- `MemoryLeakSuspected` (warning): `+8 GiB ex-ARC over 24h` for 4h — `resource-monitoring.ts:76`

At 71% memory + 0 swap (Talos by design), none of the replacement alerts are anywhere near firing. The 1163/s vs 723/s 24h-avg pgmajfault rate is normal disk I/O (Prometheus TSDB compaction + bazarr/ffmpeg restart-cycle page-cache eviction in their memcgs), not memory exhaustion.

**Action:** none. The audit's "Major Issue #10" is closed by virtue of the silence already being in place. Update the audit's coverage-gaps list at next iteration to remove this entry.

## Cluster C — Home Assistant data signals (`home` Yellow + PD #4399 + PD #4408)

Full 59-entity breakdown captured live via the HA REST API. Eight integrations contribute; **none** is the "front-door MQTT bridge" the audit hypothesized. All three home pods (`home-homeassistant`, `home-zwave-js-ui`, `home-eufy-security-ws`) are 1/1 Running.

| Integration / device                             |                            Entities | Root cause                                                                                                                                                                                                               | Action                                                                                                                             |
| ------------------------------------------------ | ----------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `mobile_app` — iPad #1 (`iPad14,1`)              |                                  13 | HA Companion app inactive / uninstalled — every sensor reports `unknown` until next foreground push                                                                                                                      | Re-open the Companion app, or delete the device from HA → Settings → Devices → Mobile App if the iPad is retired                   |
| `mobile_app` — iPad #2 (`iPad16,3`)              |                                   8 | Same                                                                                                                                                                                                                     | Same                                                                                                                               |
| Sonos (Era 100 "Bedroom" + Roam "Play")          |                                  10 | Two speakers offline; the Roam reports `_charging` + `_battery` → battery dead                                                                                                                                           | **Plug in the Roam to charge; power-cycle the Era 100.** Sonos config entry is `loaded` — no HA-side action needed                 |
| Mysa / SmartThings `_electricity_rate` (4 rooms) |                                   7 | SmartThings cloud returning `null` for the rate provider; flapping pattern                                                                                                                                               | Wait 24h; if persistent, reload the SmartThings config entry from the HA UI                                                        |
| Sonoff S31 plug ("Living Room Console 3")        |                                   6 | Plug offline (unplugged or Wi-Fi dropped)                                                                                                                                                                                | Power-cycle the plug, or remove from eWeLink if retired                                                                            |
| Roomba (j955020)                                 |                                   4 | Robot in deep-sleep / off the dock; iRobot cloud only publishes counters while awake                                                                                                                                     | None — benign                                                                                                                      |
| **Petlibro Granary Smart Camera Feeder**         | **3** + PD #4408 (1 separate alert) | Feeder offline; HA log: `manual_feed_quantity is None for AF03013100045C344024C9`. PD #4408 (`desiccant_remaining_days = -67`) is the same device.                                                                       | **Replace desiccant cartridge + check feeder Wi-Fi / batteries.** Closes a subset of #4399 (−3 entities) and the entirety of #4408 |
| HA Cloud (Nabu Casa not signed in)               |                                   3 | `conversation`/`stt`/`tts` default-`unknown` until pipeline assigned                                                                                                                                                     | None — long-standing benign                                                                                                        |
| EcoNet HPWH `_today` counters                    |                                   2 | Cloud reports `null` outside business hours / on rate-limit                                                                                                                                                              | None — benign                                                                                                                      |
| Kumo Mitsubishi humidity                         |                                   2 | Some Mitsubishi mini-split firmwares don't report humidity                                                                                                                                                               | None — benign                                                                                                                      |
| Reolink `siren.front_door_siren`                 |                                   1 | Reolink siren reports `unknown` when idle (capability-state null)                                                                                                                                                        | None — **NOT** an MQTT bridge issue (audit was wrong)                                                                              |
| AsusWRT `download_speed`                         |                                   1 | Router temp/speed sensor flapping with `Connection failed` errors                                                                                                                                                        | None — transient                                                                                                                   |
| `person.fengyu`                                  |                                   1 | Person record was created without ever attaching a `device_tracker`. `device_trackers: []`, `user_id: null`. No automation references it (verified `grep fengyu` across repo: 0 hits in HA config or Temporal workflows) | **Delete the person from HA → Settings → People** (one-click), or attach a tracker if Fengyu is a real household member            |
| **Total**                                        |                              **59** |                                                                                                                                                                                                                          |                                                                                                                                    |

**Code change to clean up steady-state-`unknown` noise (optional):** extend the rejected-domain list at `packages/homelab/src/cdk8s/config/homeassistant/configuration.yaml:91,100` from `['group','automation','scene','script','button','event','number','select','text','update']` to also include `'siren','conversation','stt','tts'`, and add a glob blocklist for steady-`unknown` upstream sensors (Kumo humidity, EcoNet `_today` counters). This drops the count from 59 to ~15 without losing real signal.

**Closes:** PD #4408 entirely; PD #4399 partially (down to ~46 entities once Sonos + Granary + Sonoff are back; further down to ~15 if the template is tightened).

## Cluster D — Velero (PD #4235 + PD #4411)

### PD #4235 — Weekly backup PartiallyFailed (qbittorrent-pvc, R2 SignatureDoesNotMatch HTTP 403)

**Audit's "SeaweedFS S3" framing was wrong.** Velero writes to **Cloudflare R2** (both `BackupStorageLocation` and `VolumeSnapshotLocation` at `velero.ts:75-109`). Credentials come from the `cloud-credentials` k8s Secret reconciled by the 1Password Operator from item `ypce2djferc6zf7bocxft36n6a` in vault `v64ocnykdqju4ui6j6pua56xw4`.

Two well-known causes for `SignatureDoesNotMatch` on a Velero multipart upload to R2:

1. **Stale `cloud-credentials` Secret** — the operator hasn't re-synced after an R2 token rotation, so the in-cluster Secret has an old `aws_secret_access_key`.
2. **Multipart-specific signing edge case** — the qbittorrent PVC is the largest media volume; with `multiPartChunkSize: 20 MiB`, it's the most parts and the most exposed to clock skew or chunk-edge bugs. Smaller PVCs in the same backup don't hit a multipart edge.

**Recommended diagnostics (read-only; user runs):**

```bash
# 1. Clock skew (cheapest cause)
talosctl time
kubectl exec -n media deploy/qbittorrent -- date -u
# > 30s skew vs time.cloudflare.com → fix NTP

# 2. Compare 1P item update time vs in-cluster Secret timestamp
kubectl -n velero get onepassworditem cloud-credentials -o yaml
op item get ypce2djferc6zf7bocxft36n6a --vault v64ocnykdqju4ui6j6pua56xw4 --format json | jq '.fields[] | {label, type, updated}'
# If 1P is newer → restart the 1Password Connect operator pod or annotate the OnePasswordItem to force re-sync

# 3. After fix, re-run weekly ad-hoc
velero backup create weekly-backup-rerun-20260508 --from-schedule weekly-backup --include-namespaces media --selector velero.io/backup=enabled
```

**Risk:** **Do NOT** rename 1P fields or modify the 1P item (per `feedback_dont_modify_1p_items`). If field names don't match what Velero wants, fix the OnePasswordItem mapping in code.

**Files:** `packages/homelab/src/cdk8s/src/resources/argo-applications/velero.ts:22-34, 75-109`. 1P item: `vaults/v64ocnykdqju4ui6j6pua56xw4/items/ypce2djferc6zf7bocxft36n6a`.

### PD #4411 — 4 orphan ZFS snapshots

Confirmed inventory (decoded from snapshot suffix `qbittorrent-verify-20260505-151742` = Unix `1778019465` = 2026-05-05 22:17:42 UTC):

| PVC                     | Approx size |
| ----------------------- | ----------- |
| `media/bazarr-pvc`      | ~1–2 MiB    |
| `media/plex-pvc`        | ~1–2 MiB    |
| `media/maintainerr-pvc` | <1 MiB      |
| `media/overseerr-pvc`   | <1 MiB      |

Total ~6 MiB, all on `zfspv-pool-{nvme,hdd}/pvc-…`. No matching Velero `Backup` CR. Audit hypothesis confirmed: ad-hoc `zfs snapshot` taken during PD #4235 remediation that captured the wrong PVC pattern (`media/*-pvc` vs the intended `media/qbittorrent-pvc`).

**Action:** follow the existing runbook [`2026-05-05_velero-orphan-snapshot-remediation.md`](2026-05-05_velero-orphan-snapshot-remediation.md). Execute the `comm -23` diagnosis (Step 2), the dry-run preview (Step 4), then `zfs destroy` (Step 5). Decision context: [`2026-05-05_velero-orphan-snapshot-prevention.md`](../decisions/2026-05-05_velero-orphan-snapshot-prevention.md) (Option 1 — manual remediation by design; auto-prune deferred).

**Pitfalls (from runbook):** never `zfs destroy -R`; never strip Backup CR finalizers; the Step 3 sanity-check (`grep -c "qbittorrent-verify-20260505-151742" /tmp/orphans-local.txt` → expect 4) is non-optional.

## Cluster E — zfspv-pool-nvme fragmentation 61% (PD #4254 + PD #4255)

**Stale by policy.** The 2026-05-05 decision raised thresholds to `>80%` warning / `>90%` critical on SSD pools (commit `4b31fc276`). Current value 61% is 19 percentage points below the new warning threshold; no rule currently fires. The two open PDs are residual fires from 2026-05-04 under the old `>50%` policy.

**Action:** ack/resolve PD #4254 + #4255 with note "Superseded by 2026-05-05 decision; thresholds raised to >80% / >90%; current value 61% is below warning threshold." No code change.

**Files:** `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/zfs-maintenance.ts:17,35`. Decision: [`2026-05-05_zfs-fragmentation-acceptance.md`](../decisions/2026-05-05_zfs-fragmentation-acceptance.md).

## Cluster F — Released PV `pvc-4ada0fa5-…` (PD #4248)

**Verdict: DELETE.** The PV is leftover from the in-cluster `better-skill-capped-fetcher` workload that was deliberately retired on 2026-04-21 (commit `1b32bea9f`). The commit message explicitly notes the cleanup case:

> Delete the cdk8s CronJobs/Jobs (better-skill-capped-fetcher, dependency-summary, dns-audit, golink-sync PostSync hook) … **Orphan ArgoCD apps and the empty better-skill-capped / dependency-summary / dns-audit namespaces will be pruned from the cluster after merge.**

Replacement runs in Temporal (`fetcher-skill-capped` schedule, cron `0 5 * * *`, `packages/temporal/src/activities/dns-audit.ts:11`). The static-site path uses the `better-skill-capped` SeaweedFS bucket (`packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts:10`), not a PVC.

**Action (user runs):**

```bash
# 1. Confirm namespace empty
kubectl get all,pvc -n better-skill-capped --ignore-not-found

# 2. Re-confirm PV state
kubectl get pv pvc-4ada0fa5- -o jsonpath='{.spec.claimRef.namespace}/{.spec.claimRef.name} policy={.spec.persistentVolumeReclaimPolicy} status={.status.phase}{"\n"}'

# 3. Delete PV (Retain → manual delete is the intended exit)
kubectl delete pv pvc-4ada0fa5-<rest-of-uid>

# 4. (Optional) reap the orphan ZFS dataset
NODE_POD=$(kubectl -n openebs get pod -l role=openebs-zfs,app=openebs-zfs-node -o jsonpath='{.items[0].metadata.name}')
kubectl -n openebs exec -i $NODE_POD -c openebs-zfs-plugin -- zfs list zfspv-pool-nvme/pvc-4ada0fa5-...
# If still there: kubectl -n openebs exec ... -- zfs destroy zfspv-pool-nvme/pvc-4ada0fa5-...

# 5. (Optional) prune empty namespace
kubectl delete namespace better-skill-capped --ignore-not-found
```

Closes PD #4248. Reclaims 1 GiB on `zfspv-pool-nvme` (which is at 61% fragmentation per Cluster E — every bit helps, though Cluster E is itself stale).

## Cluster G — Persistent restart loops

### `openebs-localpv-provisioner` (Y7) — Accept and document

The brittle `pgrep` liveness probe is hardcoded in the upstream `openebs/dynamic-localpv-provisioner` 4.2.0 chart. The umbrella `openebs/openebs` 4.4.0 chart only exposes `localpv-provisioner.rbac.create`; the subchart's `localpv.healthCheck` block exposes only `initialDelaySeconds` and `periodSeconds`, not the probe command.

Verified via `helm show values` and `helm template`: probe is

```
livenessProbe:
  exec:
    command: [sh, -c, 'test `pgrep -c "^provisioner-loc.*"` = 1']
```

with no override hook.

**Action:** accept and file an upstream issue. Provisioner is functioning between restarts (13 restarts over the pod's lifetime, last >2d ago — slow rate, not a crashloop). PVC provisioning works (58/58 PVCs Bound). Optional mitigation: bump `localpv.healthCheck.periodSeconds` 60 → 120 and `initialDelaySeconds` 30 → 60 to halve probe pressure. Requires the helm-types umbrella schema to allow nested overrides under `localpv-provisioner` (currently doesn't expose `localpv.healthCheck`).

**Files:** `packages/homelab/src/cdk8s/src/resources/argo-applications/openebs.ts` (no override exists today). Pinned version: `packages/homelab/src/cdk8s/src/versions.ts` `openebs = "4.4.0"`.

### `redlib` (Y8) — Upstream issue tracking

**Audit was wrong about credential rotation.** redlib does OAuth token spoofing (impersonating iOS/Android Reddit apps); it does not accept user-supplied client credentials. Repo-wide grep for `REDDIT_CLIENT|REDLIB_OAUTH|reddit_oauth` returns zero hits. The cdk8s chart wires only cosmetic env vars (`REDLIB_DEFAULT_THEME`, etc.).

Real cause is upstream issue [redlib-org/redlib#551 "Docker Image OAuth Errors"](https://github.com/redlib-org/redlib/issues/551), open since 2026-04-25. Reddit periodically tightens fingerprinting and breaks redlib's spoofed flow. Image is currently pinned to `sha-ba98178` (`packages/homelab/src/cdk8s/src/versions.ts:24`).

**Action:** watch upstream #551; once a fix lands, bump the digest. Until then accept cosmetic Yellow — endpoint is reachable between restarts (216 restarts over the pod's lifetime, audit confirmed "endpoint stays reachable"). Per `feedback_never_silence_renovate`, **do not** silence the redlib datasource.

## Cluster H — Bugsink hot issues

| ID     | Project             | Status                                                           | Verdict / action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B1** | scout-for-lol       | Satori "Image source is not provided" 226 ev — **already fixed** | Commit `1e3cd4f85` (2026-05-04 23:09 PT, "stop OpenAI burn loop and stale-match alerts") added placeholder + cursor advance + per-match dedup. Commit `8946b9f53` (2026-05-08 19:21 PT, "render placeholder for missing item icons + alert on report failures") hardened the placeholder, added structured logging, and added new PrometheusRules `ScoutMatchReportFailuresHigh` + `ScoutItemCacheMissesSustained` (`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout.ts`). Call site: `packages/scout-for-lol/packages/report/src/dataDragon/image-cache.ts:62-115`. Wait 24h post-deploy, confirm event rate drops to ~0, then mark Bugsink issue resolved manually. |
| **B2** | scout-for-lol       | OpenAI 429 quota 33 ev — **billing-side**                        | Burn-loop already fixed by `1e3cd4f85` (cursor advance + `MatchAiAttempt` persistent dedup table; in-memory budgets at `packages/scout-for-lol/packages/backend/src/league/review/openai-budget.ts`). Remaining 429s are **account-level monthly quota**, not a code loop. Action: top up OpenAI billing. Optional hardening: in `packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts`, catch `OpenAI.APIError` with `error.status === 429` and surface as `scout_openai_quota_exceeded_total` counter (separate from the in-memory `OpenAIBudgetExceeded`). Per `feedback_no_type_assertions`, do NOT use `as` casts to narrow the error.                                   |
| **B3** | birmel              | Discord 5xx triplet 47 ev — **external**                         | Discord status page confirms an "Increased API Errors" incident in the same window (timezone-label mismatch: 12:00–15:22 UTC vs published 12:08–15:38 PDT — same shape if one is mislabeled). Birmel retry config (`packages/birmel/src/discord/client.ts:1-18`): `rest: { timeout: 30_000, retries: 3 }`. Three retries caught most events; only 47 reached Bugsink in 90 minutes. Action: none. Optional hardening: bump retries 3 → 5 for sustained-incident tolerance; not required.                                                                                                                                                                                                         |
| **B4** | temporal            | "Webpack finished with errors" 23 ev — **already resolved**      | Commit `7659428f1` (2026-05-05 16:47:46 PT, "fix(temporal): move buildPrBody out of the workflow webpack bundle path") landed mid-incident: 16 min after first event (16:31), 1h18m before last event (18:05). Three days quiet since. Stacktrace cause: `docs-groom-pr.ts → docs-groom-impl.ts → @sentry/bun → node-core` chain pulling `node:` schemes into webpack; fix moved `buildPrBody` to `packages/temporal/src/shared/docs-groom-pr-body.ts` (Sentry-free pure module). Action: mark Bugsink issue `caaa90db-5f9c-474f-b528-cb1910e1733c` resolved.                                                                                                                                    |
| **B5** | better-skill-capped | AxiosError "Request aborted" 2 ev — **benign**                   | Browser-extension navigation race at `packages/better-skill-capped/src/manifest-loader.ts:10` — user closes/navigates while `axios.get("/data/manifest.json")` is in flight; browser cancels via `XMLHttpRequest.abort()`. Action: none — too low volume to filter, and filtering would silence legitimate aborts. Revisit if volume rises 10×.                                                                                                                                                                                                                                                                                                                                                  |

## Cluster I — Temporal workflow failures

### Tp1 — `runScoutDataDragonVersionCheck` (ENVIRONMENT bug)

PR #707 (`fix(temporal): pin ENVIRONMENT=dev for scout-data-dragon`) is open, MERGEABLE, all 25 checks green. **Action: merge PR #707.** Continues to fail every cycle until merged.

### Tp2 — `runDocsGroomAudit` (Anthropic billing/auth)

PR #710 (`fix(temporal): force claude CLI onto subscription auth, drop ANTHROPIC_API_KEY`) was in flight at audit time (build #1796). **Action: track PR #710 through CI to merge; no duplicate fix needed.**

### Tp3 — `goodMorningEarly` 30m TIMEOUT — **structural bug**

**Killer finding.** The workflow does:

1. `set_temperature` (climate, fast)
2. `await sleep(MORNING_HEAT_DURATION)` where `MORNING_HEAT_DURATION = "60 minutes"` (`packages/temporal/src/workflows/ha/good-morning.ts:18-19,32-43`)
3. `turn_off`

The schedule sets `workflowExecutionTimeout: "30 minutes"` for both weekday-early and weekend-early variants (`packages/temporal/src/schedules/register-schedules.ts:147-155, 176-185`). **A 60-minute sleep cannot complete inside a 30-minute timeout.** Every firing of `goodMorningEarly` is structurally guaranteed to time out. Live workflow describe confirms:

```
WorkflowId  good-morning-weekday-early-workflow-2026-05-08T14:00:00Z
RunTime     30m0s
Status      TIMEOUT
History (21 events):
  event 14: ACTIVITY_TASK_SCHEDULED  callService (set_temperature)
  event 16: ACTIVITY_TASK_COMPLETED  (14:00:00.657Z)
  event 20: TIMER_STARTED            (the 60-minute sleep)
  event 21: WORKFLOW_EXECUTION_TIMED_OUT   (14:30:00.127Z — exactly 30 min later)
```

Recent commits did NOT fix this: `7681cb449` (5/5) capped temp at 30 °C; `e2ddeaa6a` (5/8) added presence debounce. Neither touches `register-schedules.ts` or the 60-minute sleep.

**Recommended fix (two changes, both required):**

```ts
// packages/temporal/src/schedules/register-schedules.ts
// Lines 153 and 183 (weekday-early + weekend-early)
- workflowExecutionTimeout: "30 minutes",
+ workflowExecutionTimeout: "75 minutes",  // 60-minute sleep + 15-minute slack
```

```ts
// packages/temporal/src/workflows/ha/util.ts:13-15
// Cap unbounded retries on HA activity calls — when HA returns 500,
// the default retry policy is unbounded with maximumInterval: "100s",
// which can also burn the whole workflow timeout.
const { callService } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
+ retry: { maximumAttempts: 3 },
});
```

**Risk:** timeout bump is risk-free; activity retry cap is a pure improvement (prevents silent retry storms when HA is partially down). The 5/8 failing run had a `continuedFailure` from a prior HA `500 Internal Server Error` on `set_temperature` — without the retry cap, the HA-down path also burns the whole timeout.

Cross-reference: [`2026-05-05_mysa-max-temp-cap.md`](../plans/2026-05-05_mysa-max-temp-cap.md) is the upstream-PR cap (`MORNING_HEAT_TEMP_C = 30`); related but does not address the timeout issue.

## Cross-Cutting Items

- **Audit needs an errata pass.** Five of the audit's claims should be revised at next iteration (see [Audit Corrections](#audit-corrections)). The audit's overall TL;DR / matrix / cross-validation are accurate; only the specific findings listed are wrong.
- **PD coverage gaps** the audit flagged are mostly false positives. Of the 4× `KubePdbNotEnoughHealthyPods` and 1× `NodeMemoryMajorPagesFaults` "without PD coverage", all 5 are intentionally silenced at `prometheus.ts:326-340`. The only real gap is the kubeconfig admin client cert expiry, which carries forward from baseline.
- **Bugsink retention.** Hardcoded 180d at `packages/temporal/src/activities/bugsink.ts:25-30`. After the 5/5 PVC expansion to 8 GiB this is no longer pressing, but if you want a second-line guarantee, tighten the days argument here to 90 in the same retention activity.
- **toolkit `pd incident <ID>`** Zod validation regression (audit Major Issue #13) blocks per-incident lookups. All five investigation agents fell back to `--json` parsing. Fix the schema for `log_entries[].agent` (likely `agent` is sometimes nullable or needs a discriminated union).

## Followups (separate plan-doc candidates)

These items are big enough that they may warrant their own plan files; I'm not creating them automatically per the investigate-only scope:

| Followup                                                | Why a plan file might help                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Bump Talos node v1.12.0 → v1.13.0 (PR #591 ready)       | Cross-impacts the talosctl skew warning, the kubeconfig cert backfill, and the upcoming Talos AppArmor changes     |
| Tighten the HA `unavailable_entities_count` template    | Drops noise from 59 to ~15 without losing real signal; involves choosing what counts as "real" vs "benign-unknown" |
| File upstream openebs/dynamic-localpv-provisioner issue | Liveness probe replacement (HTTP /healthz or pidfile) instead of pgrep                                             |
| OpenAI billing decision for scout-for-lol               | Pure billing or budget-tier cap; not a code change                                                                 |
| Update existing audit doc with errata                   | Five corrections in [Audit Corrections](#audit-corrections) — could be a small edit pass or a v2 of the doc        |

## Investigation hygiene

- All five agents ran read-only. One agent (γ) created a temporary pod `home/ha-query-tmp` (alpine/curl, restricted PSS, 600s sleep) for HA REST API queries; the pod completed and was deleted as part of compiling this doc (`kubectl delete pod -n home ha-query-tmp` — confirmed deleted).
- Zero git mutations. Zero PD ack/resolve. Zero Bugsink resolve. Zero `kubectl apply`. Zero Velero / 1Password mutations.
- Per-cluster recommendations are proposals only; user executes.
