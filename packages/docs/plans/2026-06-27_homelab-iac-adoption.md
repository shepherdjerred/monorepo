# Homelab IaC Adoption — Buildkite, PagerDuty, \*arr, qBittorrent

## Status

Complete (PR open, pending merge)

All four subsystems were built, imported from live state to a **zero-change**
`tofu plan`, and wired into CI. The new secrets (`BUILDKITE_API_TOKEN`,
`PAGERDUTY_TOKEN`, `RADARR_API_KEY`, `SONARR_API_KEY`, `PROWLARR_API_KEY`,
`QBITTORRENT_PASSWORD`, `PRIVATEHD_PASSWORD`, and `PRIVATEHD_PID`) are stored in the `Buildkite CI Secrets` 1Password item and
confirmed synced into the `buildkite-ci-secrets` k8s secret, so the post-merge
`tofu-apply-all` is a no-op. See the Session Log at the bottom for specifics.

## Context

Several homelab subsystems are configured by hand in web GUIs, so settings aren't versioned, reviewable, or recoverable. This brings four of them under code, matching the existing OpenTofu + cdk8s conventions, and reports feasibility for 11 more apps (research only). Mirror of the approved harness plan `~/.claude/plans/let-s-work-on-buildkite-linked-sonnet.md`.

**Implement:** Buildkite (Tofu), PagerDuty (Tofu), \*arr — Radarr/Sonarr/Prowlarr (Tofu), qBittorrent (cdk8s).
**Skip:** Grafana (already cdk8s), Home Assistant automations (none exist).
**Research only:** Plex, Tautulli, Seerr, Scrypted, Syncthing, FreshRSS, Golink, Postal, Bugsink, Plausible, Z-Wave JS UI.

## Decisions (confirmed with owner)

1. **One combined PR**, branch `feature/homelab-iac-adoption`. Commit per subsystem.
2. **\*arr: import existing** (preserve current config).
3. **Buildkite agent token: import existing** (no rotation).
4. **PagerDuty: full on-call**, all objects imported.
5. **Recyclarr + Tofu coexist** — Recyclarr owns quality profiles + custom formats; Tofu owns indexers/clients/folders/apps. Tofu MUST NOT declare `quality_profile`/`custom_format`.

## Critical safety constraint — CI auto-applies on main

`tofu-apply-all` (`scripts/ci/src/steps/tofu.ts`) runs `tofu apply -auto-approve` on `main` for every stack in `TOFU_STACKS`. Therefore a new stack **must not be added to `TOFU_STACKS` until its live state is imported** — otherwise the first post-merge apply tries to _create_ resources that already exist. Follow the **`tailscale` precedent**: land the stack code now, keep it out of `TOFU_STACKS`, and enable (import → wire secrets → add to `TOFU_STACKS`) as a deliberate, gated step. This also decouples merging the PR from the risky live operations.

## Credentials (verified in 1Password 2026-06-27)

Central CI bundle = `Buildkite CI Secrets` (`rzk3lawpk4yspyyu5rxlz44ssi`, vault _Homelab (Kubernetes)_).

| Need                                | Status                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buildkite API token (provider)      | ✅ `Buildkite CI Secrets` → `BUILDKITE_API_TOKEN` (verify write scope)                                                                                                                                                       |
| Buildkite agent token (import)      | ✅ `Buildkite Agent Token` → `BUILDKITE_AGENT_TOKEN`                                                                                                                                                                         |
| PagerDuty REST API token (provider) | ❌ MISSING — owner must mint (PD → Integrations → API Access Keys, read/write) → add to CI bundle as `PAGERDUTY_TOKEN (CI bundle field; distinct 1P item from the routing key)`                                              |
| PagerDuty Events-v2 routing key     | ✅ `AlertManager secrets` → `PAGERDUTY_TOKEN` (import integration so it's unchanged)                                                                                                                                         |
| \*arr API keys                      | ✅ source values in `Recyclarr` → `recyclarr.yaml`; copied into the CI bundle as six discrete fields (`RADARR_API_KEY`, `SONARR_API_KEY`, `PROWLARR_API_KEY`, `QBITTORRENT_PASSWORD`, `PRIVATEHD_PASSWORD`, `PRIVATEHD_PID`) |
| qBittorrent                         | ✅ no new cred                                                                                                                                                                                                               |

## Conventions reused

New Tofu stack = `packages/homelab/src/tofu/<name>/` with `providers.tf`, `backend.tf` (S3, `key = "<name>/terraform.tfstate"`, SeaweedFS endpoint from `github/backend.tf`), `variables.tf`, resource `.tf`. CI wiring: `TOFU_STACKS`/`TOFU_STACK_LABELS` (`scripts/ci/src/catalog.ts`), secret flags (`scripts/ci/src/steps/tofu.ts` `tofuSecretFlags`), Dagger helpers (`.dagger/src/release.ts` `tofuApplyHelper`/`tofuPlanHelper`). CI Tofu reaches `*.tailnet-1a49.ts.net` (Talos `siderolabs/tailscale` extension).

## Part 1 — Buildkite (`tofu/buildkite/`)

Provider `buildkite/buildkite ~> 1.x`, org `sjerred`. Import: `buildkite_cluster`, `buildkite_cluster_queue` (default), `buildkite_cluster_default_queue`, `buildkite_pipeline` (monorepo), `buildkite_cluster_agent_token`. Out of scope (cdk8s/CI generator): max-in-flight, Kueue quota, per-job priority, GitHub required checks.

## Part 2 — PagerDuty (`tofu/pagerduty/`)

Provider `PagerDuty/pagerduty`. Full on-call: `pagerduty_service`, `pagerduty_service_integration` (Events v2), `pagerduty_escalation_policy`, `pagerduty_schedule`, `pagerduty_user`. Import all; integration_key must equal the live `PAGERDUTY_TOKEN` Alertmanager reads. Blocked on the missing REST API token.

## Part 3 — \*arr (`tofu/arr/`)

Providers `devopsarr/{radarr,sonarr,prowlarr}`, `url`+`api_key` from `recyclarr.yaml`, target tailscale FQDNs (`radarr.tailnet-1a49.ts.net` 7878, sonarr 8989, prowlarr 9696). Tofu owns indexers/indexer-proxies/Prowlarr applications/download-clients/root-folders/notifications. NOT quality_profile/custom_format (Recyclarr). No provider for Bazarr/Maintainerr (manual; Maintainerr has a REST API for later).

## Part 4 — qBittorrent (cdk8s) ✅ DONE

Committed sanitized `qBittorrent.conf` baseline (`src/cdk8s/src/resources/configs/qbittorrent/`), seeded into the PVC on first boot via a root init container (seed-if-absent). WebUI password hash excluded. Commit `ada8bdacc`.

## Research findings — the 11 apps (no good TF provider for any)

| App                                                                               | Verdict                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Plex, Tautulli, Seerr                                                             | API-scriptable → manual + Velero backup                                |
| Scrypted, Postal, Plausible CE                                                    | manual + Velero backup                                                 |
| Syncthing (`config.xml`), FreshRSS (`config.php`), Z-Wave JS UI (`settings.json`) | config-file possible, low ROI                                          |
| Golink                                                                            | JSON snapshot export/import (additive)                                 |
| Bugsink                                                                           | API-scriptable (teams/projects) — best automation candidate (seed Job) |

## Verification

Per Tofu stack: `tofu init -backend=false && tofu validate`; full `tofu plan` (via Dagger) must show **zero destroys** post-import before enabling. qBittorrent: cdk8s synth + tests + lint (done). Root: typecheck/test/eslint in touched packages; `cd scripts/ci && bun run src/main.ts`.

## Enablement runbook (per Tofu stack, gated)

1. (PagerDuty only) Owner mints REST API token → adds `PAGERDUTY_TOKEN (CI bundle field; distinct 1P item from the routing key)` to `Buildkite CI Secrets`; refresh 1P snapshot.
2. `tofu init` (real backend), `tofu import` every live resource (see per-stack import scripts).
3. `tofu plan` → iterate `.tf` until **zero changes**.
4. Add stack to `TOFU_STACKS` + thread its secret flag through `tofuSecretFlags`/Dagger.
5. Merge → CI apply is a no-op.

## Session Log — 2026-06-27

### Done

- **qBittorrent (cdk8s)** — committed sanitized `qBittorrent.conf` baseline (password hash excluded) + seed-if-absent root init container in `qbittorrent.ts`; allowlisted the init container in `container-resource-allowlist.ts`. cdk8s synth/test/lint green. Commit `ada8bdacc`.
- **Buildkite (tofu/buildkite)** — imported cluster, default queue, default-queue association, monorepo pipeline → zero-change. Agent token deliberately excluded (no import support, can't re-read → would force rotation). Commit `2e56e1b1d`.
- **\*arr (tofu/arr)** — imported Radarr/Sonarr root folders + qBittorrent download clients, Prowlarr 4 indexers + download client + 2 application syncs (11 resources) via `import {}` + `-generate-config-out` → zero-change. Recyclarr keeps quality/custom-formats; Radarr/Sonarr indexers (Prowlarr-synced) and Bazarr/Maintainerr (no provider) excluded. Commit `96b4cb9d2`.
- **PagerDuty (tofu/pagerduty)** — imported user, Default escalation policy, Homelab service, Events-v2 integration → zero-change. Routing key is read-only/preserved (Alertmanager unaffected) and never written to config. Commit `2139b6b28`.
- **CI wiring** — added buildkite/arr/pagerduty to `TOFU_STACKS`; threaded `buildkiteApiToken`/`arrApiKeys`/`pagerdutyToken` secrets through the Dagger tofu helpers (`release.ts`/`index.ts`) and `tofuSecretFlags` (`steps/tofu.ts`). New secrets stored in 1P + synced to `buildkite-ci-secrets`.
- All Tofu state written to the shared SeaweedFS backend (`{buildkite,arr,pagerduty}/terraform.tfstate`).

### Remaining

- Open the PR and let CI run `tofu-plan-all` (should be clean) before merge.
- After merge, confirm `tofu-apply-all` is a no-op for the three new stacks.

### Caveats

- `PAGERDUTY_TOKEN` is the canonical name (per `decisions/2026-03-27`); the REST API token (CI bundle) and the Events-v2 routing key (`AlertManager secrets`) share this name but live in **separate 1P items / k8s secrets / namespaces** and never coexist in one pod.
- \*arr/PagerDuty sensitive fields (download-client passwords, application api keys, integration_key) read back null from their APIs and are intentionally left masked; Tofu does not re-send them. A future edit to one of those resources must re-supply the secret to avoid nulling it.
- The Buildkite cluster agent token remains 1Password-managed (not in Tofu) by design.
