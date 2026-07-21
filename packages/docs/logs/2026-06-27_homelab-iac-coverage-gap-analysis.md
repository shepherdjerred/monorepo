---
id: log-2026-06-27-homelab-iac-coverage-gap-analysis
type: log
status: complete
board: false
---

# Homelab IaC Coverage — Gap Analysis

## Question

For every homelab service/integration, is it code-controlled (cdk8s / OpenTofu / committed config) or managed manually via a GUI? For the gaps, what mechanism could bring it under code? (User's motivating example: Buildkite is currently managed in the web UI.)

## Mental model

Three buckets:

1. **Platform / integrations** → OpenTofu (`src/tofu/`). Mostly already code.
2. **K8s deployments** → cdk8s (`src/cdk8s/`). 100% code. _Deployment_ ≠ _app-internal config_.
3. **App-internal config** (what you'd click inside an app's own web UI) → split. Some apps have committed config files; most rely on a stateful PVC set up by hand.

The honest dividing line for the gaps: things with a real API/provider can be codified; things that are inherently stateful (SQLite/`.storage`/device pairings) are best handled by **Velero PVC backups**, not IaC.

## Already fully code-controlled (no action)

| Area                                                            | Where                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| Cloudflare DNS / tunnels / bot mgmt / email security (10 zones) | `src/tofu/cloudflare/`                                   |
| GitHub repo settings, rulesets, required checks, webhooks       | `src/tofu/github/{repos,rulesets,webhooks}.tf`           |
| Tailscale ACLs / tags / SSH                                     | `src/tofu/tailscale/`                                    |
| SeaweedFS S3 buckets (+ tofu state backend)                     | `src/tofu/seaweedfs/`                                    |
| ArgoCD token (+ minted `onepassword_item`)                      | `src/tofu/argocd/token.tf`                               |
| All K8s deployments (apps, operators, storage, monitoring)      | `src/cdk8s/`                                             |
| Buildkite **pipeline definition**                               | `.buildkite/pipeline.yml` + `scripts/ci/` (TS generator) |
| Buildkite agent deployment                                      | `src/cdk8s/.../argo-applications/buildkite.ts`           |
| Prometheus alert rules (29 files)                               | `src/cdk8s/src/resources/monitoring/.../rules/`          |
| Alertmanager routing → PagerDuty                                | `src/cdk8s/.../argo-applications/prometheus.ts`          |
| Loki alert rules, Tempo, Pyroscope, Alloy, Promtail configs     | `src/cdk8s/.../argo-applications/*.ts`                   |
| Grafana dashboards (13) + datasources                           | `src/cdk8s/grafana/`, `.../grafana-values.ts`            |
| Kometa config (inline YAML)                                     | `src/cdk8s/.../media/kometa.ts`                          |
| Recyclarr (\*arr quality/custom-format sync, from 1P)           | `src/cdk8s/.../torrents/recyclarr.ts`                    |
| Gickup repo backup list                                         | `src/cdk8s/.../configs/gickup.yml`                       |
| Home Assistant base config                                      | `src/cdk8s/config/homeassistant/configuration.yaml`      |
| Temporal dynamic config                                         | `src/cdk8s/.../temporal/dynamic-config.ts`               |
| Secret _injection_ (1P operator + OnePasswordItem CRDs)         | throughout cdk8s                                         |

## Gaps worth closing (clean IaC path)

| #   | Gap                                                                                       | Current   | Mechanism                                                                                                                                                         | Effort                                              | Value    |
| --- | ----------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------- |
| 1   | **Buildkite** cluster, queues, agent token, pipeline settings, schedules, team            | GUI       | OpenTofu `buildkite/buildkite` provider (`buildkite_cluster`, `_cluster_queue`, `_cluster_agent_token`, `_pipeline`, `_pipeline_schedule`, `_team`, org settings) | Medium (import existing)                            | **High** |
| 2   | **PagerDuty** services, escalation policies, schedules, AM integration                    | GUI       | OpenTofu `PagerDuty/pagerduty` provider                                                                                                                           | Medium                                              | Medium   |
| 3   | _\*\*arr_ indexers / download clients / root folders / app links                          | GUI (PVC) | OpenTofu `devopsarr/{radarr,sonarr,prowlarr}` (complements Recyclarr; **no Bazarr provider**)                                                                     | Medium-High (needs apps up + API keys; chicken/egg) | Medium   |
| 4   | **Home Assistant** automations/scripts/scenes (stubs are 0 bytes → live in UI `.storage`) | GUI       | Author/commit `automations.yaml` etc. (already `!include`-wired)                                                                                                  | Low                                                 | Medium   |
| 5   | **Grafana**-native alert rules / contact points / notification policies                   | GUI       | `grafana/grafana` provider _or_ file provisioning — **low priority**: the Prometheus→Alertmanager→PagerDuty path is already code                                  | Low                                                 | Low      |
| 6   | **qBittorrent** core settings                                                             | GUI (PVC) | Mount a templated `qBittorrent.conf` ConfigMap (read on boot)                                                                                                     | Low-Med                                             | Low-Med  |

## Gaps to accept (inherently stateful → rely on Velero backups, not IaC)

No mature IaC mechanism; config is SQLite/XML/`.storage`/device-pairing in a PVC. Mitigation is **PVC backup/restore**, which is already in place (Velero → R2).

Plex · Jellyfin · Tautulli · Overseerr/Seerr · Scrypted · Syncthing · FreshRSS · Golink · Postal mail-servers/domains · Bugsink projects/teams · Plausible sites · Z-Wave JS UI & eufy device pairing (keys already in 1P).

(Bugsink/Plausible/Postal each have an API, so a one-shot seeding Job is _possible_ but low ROI for a single operator.)

## 1Password note

Vault _items_ are created by hand (one exception: the Tofu-minted ArgoCD token). Putting all secret **values** in Tofu state is an anti-pattern (state would hold plaintext). Current setup is the right call: values stay manual, _structure_ is already enforced offline via `onepassword-vault-snapshot.json` + the cdk8s linter. No action recommended.

## Recommended order

1. **Buildkite → OpenTofu** — closes the exact gap raised; a plan already exists at `packages/docs/plans/2026-06-13_buildkite-opentofu.md` (Status: Not Started). Best ROI.
2. **Home Assistant automations → YAML** — cheap, high recovery value.
3. **PagerDuty → OpenTofu** — small surface, codifies the on-call path that alerting depends on.
4. **\*arr → devopsarr providers** — only if PVC-loss recovery of indexer/download-client setup is painful enough to justify a new tofu stack + API-key bootstrap.

## Sources

- Buildkite TF provider: https://registry.terraform.io/providers/buildkite/buildkite/latest
- devopsarr providers: https://registry.terraform.io/namespaces/devopsarr (radarr/sonarr/prowlarr; no bazarr)

## Session Log — 2026-06-27

### Done

- Inventoried code-control state for every homelab service across cdk8s, OpenTofu, and committed app config (3 parallel Explore sweeps + direct provider verification).
- Verified recommended providers exist (`buildkite/buildkite`, `devopsarr/*`).
- Produced this gap analysis with prioritized, mechanism-specific recommendations.

### Remaining

- No implementation done. Next actionable: execute `packages/docs/plans/2026-06-13_buildkite-opentofu.md`.

### Caveats

- \*arr OpenTofu adoption has a bootstrap ordering problem (provider needs the app running + API key) and partially overlaps existing Recyclarr sync — scope carefully.
- Bazarr has no Terraform provider.
- Grafana-native alerting gap is mostly moot because alerting already flows through code (Prometheus rules → Alertmanager → PagerDuty).
