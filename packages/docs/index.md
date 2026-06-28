# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package discovery, repo layout, and verification commands
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Release/Push/Deploy Inventory](architecture/2026-04-04_release-push-inventory.md) - External publish targets from the CI catalog
- [Temporal Worker & Agent-Task Scheduler](architecture/2026-06-06_temporal-worker-and-scheduler.md) - Worker topology, schedules, agent-task scheduler + `/agent-tasks` API, event bridge
- [Scout-for-LoL Web UI & S3/Caddy Serving](architecture/2026-06-06_scout-web-ui-and-serving.md) - Marketing site + SPA, merged bucket build, prod/beta fan-out, caddy-s3proxy routing

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
- [Scout Arena Pre-match Scrubbed Players](decisions/2026-06-07_scout-arena-prematch-scrubbed-players.md) - Privacy-scrubbed players have no usable identity in Spectator-V5, so they're dropped from the pre-match image; accepted data loss
- [Homelab Security Hardening Decisions](decisions/2026-06-06_homelab-security-hardening-decisions.md) - Owner's 2026-06-06 pen-test security decisions and the PR-1 hardening that landed

## Plans

Active or upcoming plans only — high-churn, so not individually indexed. See [`plans/`](plans/) for the current listing. Completed plans move to [`archive/completed/`](archive/completed/); thin per-session journals live in [`logs/`](logs/).

## Logs

Per-session journals (one-shot fixes, Q&A answers, bug recaps). Not individually indexed — see [`logs/`](logs/) for the directory listing.

## TODOs

General issue tracking — deferred work, acceptance-testing gaps, post-merge verifications, and source `TODO(todo:<id>)` markers. Not individually indexed — see [`todos/`](todos/) for the directory listing.

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
- [Temporal Post-Deploy Quality Checklist](guides/2026-05-22_temporal-post-deploy-quality-checklist.md) - Standard verification steps to run after a Temporal deploy
- [\*arr Stack Subtitle Strategy](guides/2026-06-27_arr-stack-subtitle-strategy.md) - Bazarr providers, forced/EN/zh targets, scoring, bilingual, Whisper & Lingarr — cited research
- [npm Granular Token Rotation](guides/2026-05-20_npm-granular-token-rotation.md) - Rotating npm granular tokens: WebAuthn-gated bypass-2FA, classic tokens retired, 90-day cap
- [Homelab SMART/NVMe Disk Metrics](guides/2026-06-28_homelab-smart-disk-metrics.md) - How disk health metrics are emitted/labeled and the serial-stability fix
- [Homelab OpenTofu Stack Addition](guides/2026-06-28_homelab-tofu-stack-addition.md) - Adding a Tofu stack: import-before-merge, secret threading, `*arr` key locations
- [LLM Models Catalog](guides/2026-06-28_llm-models-catalog.md) - Central `llm-models` catalog: JSON+Zod/Pydantic source, consumers, file: dep dist gotcha
- [MCP Gateway Architecture](guides/2026-06-28_mcp-gateway-architecture.md) - tbxark/mcp-proxy aggregation, TCP-probe readiness caveat, token rendering
- [Redlib glibc Self-Build](guides/2026-06-28_redlib-glibc-self-build.md) - Why homelab self-builds redlib's glibc image (musl OAuth block) and how it's pinned
- [Scout App Monaco / CSP](guides/2026-06-28_scout-app-monaco-csp.md) - Embedding Monaco / worker libs in the scout web app under strict CSP
- [Scout Pre-match Debugging](guides/2026-06-28_scout-prematch-debugging.md) - Spectator payload archival to S3 + pre-start lobby detection
- [Scout Report Dispatcher](guides/2026-06-28_scout-report-dispatcher.md) - Sync vs scheduler separation and freshness-gauge gating
- [SeaweedFS Static-Site Hosting](guides/2026-06-28_seaweedfs-static-site-hosting.md) - Static-site topology + the 403 / volume-count / HEAD gotchas and fixes
- [Smoke Test Discord Flakiness](guides/2026-06-28_smoke-test-discord-flaky.md) - Why `smoke-scout-for-lol` flakes (live discord.com) and how to recover
- [Talos Lockdown & eBPF](guides/2026-06-28_talos-lockdown-ebpf.md) - secure-boot `lockdown=confidentiality` kills eBPF profiling; diagnosis
- [Vendoring Package Checklist](guides/2026-06-28_vendoring-package-checklist.md) - Every wiring/exclusion list to update when vendoring a third-party package

## Archive

Historical docs preserved for reference. These are no longer actively maintained.

- [`archive/bazel/`](archive/bazel/) - 12 docs from the Bazel era
- [`archive/changelogs/`](archive/changelogs/) - 1 historical changelog
- [`archive/completed/`](archive/completed/) - 87 plans whose work has shipped (preserves design context)
- [`archive/dagger-migration/`](archive/dagger-migration/) - 18 Dagger migration plans and audits
- [`archive/homelab-audits/`](archive/homelab-audits/) - 9 superseded homelab health audit snapshots
- [`archive/on-hold/`](archive/on-hold/) - 4 on-hold Sentinel architecture and implementation docs
- [`archive/scout-followups/`](archive/scout-followups/) - 1 time-boxed Scout follow-up checklist
- [`archive/stale/`](archive/stale/) - 8 stale operational snapshots and superseded plans
- [`archive/superseded/`](archive/superseded/) - 9 plans/guides replaced by newer versions
