# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package discovery, repo layout, and verification commands
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Release/Push/Deploy Inventory](architecture/2026-04-04_release-push-inventory.md) - External publish targets from the CI catalog

## Patterns

- [ESLint Configuration](patterns/2026-02-22_eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

- [Dagger --source . vs Plain Steps](decisions/2026-04-03_dagger-source-vs-plain-steps.md) - Tradeoff: full-repo copy cost in Dagger vs isolation loss in plain Buildkite steps
- [CI Security Audit](decisions/2026-04-04_ci-security-audit.md) - Buildkite + Dagger security audit for external contributor safety
- [Unified Versioning Strategy](decisions/2026-04-04_unified-versioning-strategy.md) - Restored Era 1 versioning with `2.0.0-BUILD` format
- [Env Var Naming Convention](decisions/2026-03-27_env-var-naming-convention.md) - Canonical env var names across 1Password, K8s, CI, and shells
- [Kueue for Buildkite Resource Management](decisions/2026-03-18_kueue-buildkite-resource-management.md) - Why Kueue replaced ResourceQuota for CI job admission
- [Dagger Disk Write Amplification](decisions/2026-02-23_dagger-disk-write-amplification.md) - Disk-write amplification analysis and mitigation; supplemented by the 2026-05-10 disk-write-reduction work in `archive/completed/`
- [1Password Deduplication](decisions/2026-03-08_1password-deduplication.md) - Deduplicating 1Password secret references
- [Renovate HA Manager Disabled](decisions/2026-04-05_renovate-homeassistant-manager-disabled.md) - Disabled homeassistant-manifest manager for non-HA manifests
- [CI Build Scoping Fixes](decisions/2026-04-26_ci-build-scoping-fixes.md) - Three bugs causing every main build to rebuild all 25 packages; fixed baseline lookup and Renovate fast-track
- [Velero Orphan-Snapshot Prevention](decisions/2026-05-05_velero-orphan-snapshot-prevention.md) - Why we chose detection + manual remediation over self-healing for Velero orphan ZFS snapshots and R2 objects
- [ZFS Fragmentation Acceptance](decisions/2026-05-05_zfs-fragmentation-acceptance.md) - Why we raised the fragmentation alert thresholds on SSD pools instead of mitigating

## Plans

Active or upcoming plans only. Completed plans live in `archive/completed/`; thin per-session journals live in `logs/`.

- [Bedrock Waker](plans/2026-03-01_bedrock-waker.md) - UDP proxy to wake sleeping Minecraft Bedrock servers
- [CI Reporting & Artifact Collection](plans/2026-04-04_ci-reporting-artifacts.md) - Structured CI reports, coverage, and artifacts
- [CI Security Remediation](plans/2026-04-04_ci-security-remediation-plan.md) - Defense-in-depth work before enabling external contributor CI
- [Accelerated CI for Release-Please](plans/2026-04-05_accelerated-ci-release-please.md) - Fast path for automated version-bump and release PRs
- [CI Quality Hardening](plans/2026-04-05_ci-quality-hardening.md) - Make Trivy, Semgrep, and Knip hard failures
- [OpenTofu Audit & Expansion](plans/2026-04-05_opentofu-audit-expansion.md) - Existing tofu module gaps and candidate providers
- [Scout Branded Types](plans/2026-04-05_scout-branded-types.md) - Add missing branded domain IDs to scout-for-lol
- [Move Scripts to Packages](plans/2026-04-07_move-scripts-to-packages.md) - Relocate root scripts into package-owned paths
- [Dagger CI Infrastructure Fixes](plans/2026-04-21_dagger-ci-infra-fixes.md) - Punch list for ciAllHelper and Dagger infra bugs
- [Temporal Tailscale Exposure](plans/2026-04-21_temporal-tailscale-exposure.md) - Expose Temporal gRPC over Tailscale without port-forwarding
- [Homelab Ops Hardening Backlog](plans/2026-04-25_homelab-ops-hardening-backlog.md) - Active follow-ups from the archived homelab ops audit
- [Monarch Match-Rate Fixes](plans/2026-04-25_monarch-match-rate-fixes.md) - Diagnose and fix Monarch transaction classifier match rate
- [Polyrepo → Monorepo Link Audit](plans/2026-04-25_polyrepo-link-audit.md) - Rewrite all stale polyrepo URLs to monorepo + add lychee CI link-check gate
- [Renovate Blocked Majors](plans/2026-04-25_renovate-blocked-majors.md) - Dedicated-session dependency upgrades and deploy promotions
- [Shared Glitter-Context Package](plans/2026-04-25_shared-glitter-context-package.md) - De-duplicate style cards and lore across Birmel and Scout
- [Tasks for Obsidian iOS Target Wiring](plans/2026-04-25_tasks-for-obsidian-ios-target-wiring.md) - Finish native iOS target wiring after the completed audit
- [HomeKit Vacuum via Matter Hub](plans/2026-05-05_homekit-vacuum-via-matter-hub.md) - Deploy `t0bst4r/home-assistant-matter-hub` to expose HA `vacuum.*` entities to Apple Home
- [Mysa HACS Max-Temp Cap](plans/2026-05-05_mysa-max-temp-cap.md) - Local hotfix at 30 °C while upstream PR kgelinas/Mysa_HA#18 lands the 40 °C support
- [Docs Grooming: plans/logs split](plans/2026-05-10_docs-grooming-plans-logs-split.md) - Split `plans/` into `plans/` + new `logs/`; broader docs staleness/status/link audit
- [NVMe Firmware Update Runbook](plans/2026-05-10_firmware-update-runbook.md) - Single-window 4B2QJXD7 → 8B2QJXD7 update for both Samsung 990 PRO drives on single-node Talos
- [PR Review Bot Phase 8 Emit-Site Wiring](plans/2026-05-10_pr-review-bot-emit-site-wiring.md) - Fire the Phase 8 metrics from the workflow + activity path
- [PR Review Bot Phase 10 — Continuous-Eval Harness](plans/2026-05-10_pr-review-bot-phase-10-continuous-eval.md) - Held-out fixture corpus, nightly Temporal cron, Postgres eval store, and precision-regression alerts
- [PR Review Bot Phase 8 — Measurement](plans/2026-05-10_pr-review-bot-phase-8-measurement.md) - Prometheus metrics, Grafana dashboard, and PagerDuty alerts for the SOTA PR review bot
- [SOTA PR Review Bot](plans/2026-05-10_sota-pr-review-bot.md) - Full-spec multi-agent + verification + retrieval + continuous-eval PR review bot; supersedes the archived 2026-04-25 plan
- [Scout HIGHEST_RANK chart drops-to-0 fix](plans/2026-05-11_scout-highest-rank-chart-fix.md) - Stop fabricating Iron IV / 0 LP entries, hide chart dot markers, clean active-competition S3 snapshots
- [Scout Season Dropdown Hardening](plans/2026-05-11_scout-season-dropdown-hardening.md) - Fail-fast guard so an empty `getSeasonChoices()` no longer degrades `/competition`'s season option to free text
- [Renovate-481 Fixes & CI Gap](plans/2026-05-12_renovate-481-fixes-and-ci-gap.md) - Unbreak main after the renovate-481 sweep (Prisma 7 schemas, react-dom skew, birmel start, temporal lint) and remove `MAIN_ONLY` from validation-only CI steps so PRs catch the same class of regression pre-merge

## Logs

Per-session journals (one-shot fixes, Q&A answers, bug recaps). Not individually indexed — see [`logs/`](logs/) for the directory listing.

- [Fix trmnl-dashboard helm chart](plans/2026-05-10_fix-trmnl-dashboard-helm-chart.md) - Add the missing `Chart.yaml` skeleton so Dagger's `helmPackageHelper` can package the chart (Buildkite #1915)
- [trmnl-dashboard Dagger Image](plans/2026-05-10_trmnl-dashboard-dagger-image.md) - Build trmnl-dashboard via Dagger (no Dockerfile) with non-root user; unblock degraded ArgoCD app
- [TaskNotes Recurring Fix + Wiring](plans/2026-05-10_tasknotes-recurring-and-wiring.md) - Fix recurring-task drop bug; wire half-built subsystems (offline sync, Pomodoro, Live Activities, time-tracking UI, markdown rendering)
- [update-versions.ts: same-line entry fix](plans/2026-05-10_update-versions-script-fix.md) - Fix commit-back script clobbering closing `};` in versions.ts when key+value share a line
- [Update docker / helm / infra-tool pins (round 2)](plans/2026-05-10_update-docker-helm-images-round2.md) - Bundle Renovate dashboard #481 docker/CI-tool bumps after #748: prod tags, Dagger base images, ci-base tools
- [Talos/Kubernetes Connectivity Investigation](plans/2026-05-10_talos-k8s-connectivity.md) - Diagnose local Talos and Kubernetes access failures from configured contexts and network reachability
- [Bugsink/Temporal Error Spike Investigation](plans/2026-05-10_bugsink-temporal-error-spike.md) - Correlate current Bugsink issue influx with Temporal worker/server and Kubernetes restart fallout

## Guides

- [Monarch Accuracy Test](guides/2026-02-22_monarch-accuracy-test.md) - Monarch transaction categorization accuracy testing
- [Dotfiles Update](guides/2026-03-08_dotfiles-update.md) - Dotfiles update script and known issues
- [Local Quality Check](guides/2026-04-03_local-quality-check.md) - Full monorepo verification commands
- [Helm Escaping Pipeline](guides/2026-04-04_helm-escaping-pipeline.md) - Template escaping across TypeScript, cdk8s, Helm, and consumers
- [Homelab Audit Runbook](guides/2026-04-04_homelab-audit-runbook.md) - Repeatable comprehensive cluster health audit
- [Is My Commit Deployed?](guides/2026-04-06_is-commit-deployed.md) - Trace a commit through CI, images, charts, and ArgoCD
- [NVMe Wear Attribution](guides/2026-04-21_nvme-wear-attribution.md) - Byte-level accounting of NVMe write sources
- [Type-safe Home Assistant Client](guides/2026-04-21_type-safe-home-assistant-client.md) - `ha-codegen`, generated schema, and Temporal usage
- [Birmel Remediation Follow-ups](guides/2026-04-25_birmel-remediation-followups.md) - Post-deploy checks and deferred cleanup from Birmel remediation
- [Home Assistant Cleanup Followups](guides/2026-04-25_home-assistant-cleanup-followups.md) - HA cleanup tasks from the 2026-04-25 audit
- [Minecraft Server Ops](guides/2026-04-25_minecraft-server-ops.md) - Operational reference for deployed modded Minecraft servers
- [Home Assistant Kumo Troubleshooting](guides/2026-05-04_home-assistant-kumo-troubleshooting.md) - Diagnosing `device_authentication_error`, the V3 cloud / Socket.IO password flow, the Murata-OUI DHCP-filter gap, and the cache-rewrite fix recipe
- [Velero Orphan-Snapshot Remediation](guides/2026-05-05_velero-orphan-snapshot-remediation.md) - Procedure for manually pruning orphan ZFS snapshots and R2 objects when the audit workflow alerts
- [Homelab Health Audit (2026-05-08)](guides/2026-05-08_homelab-health-audit.md) - Current cluster health audit snapshot
- [Homelab Issue Investigation (2026-05-08)](guides/2026-05-08_homelab-issue-investigation.md) - Root-cause deep dive on every Yellow row, PD incident, and Bugsink issue from the audit

## Archive

Historical docs preserved for reference. These are no longer actively maintained.

- [`archive/bazel/`](archive/bazel/) - 12 docs from the Bazel era
- [`archive/changelogs/`](archive/changelogs/) - 1 historical changelog
- [`archive/completed/`](archive/completed/) - Plans whose work has shipped (preserves design context)
- [`archive/dagger-migration/`](archive/dagger-migration/) - 18 Dagger migration plans and audits
- [`archive/homelab-audits/`](archive/homelab-audits/) - 9 superseded homelab health audit snapshots
- [`archive/on-hold/`](archive/on-hold/) - 4 on-hold Sentinel architecture and implementation docs
- [`archive/scout-followups/`](archive/scout-followups/) - 1 time-boxed Scout follow-up checklist
- [`archive/stale/`](archive/stale/) - 7 stale operational snapshots and superseded plans
- [`archive/superseded/`](archive/superseded/) - Plans/guides replaced by newer versions
