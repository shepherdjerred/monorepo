# Monthly Changelog: Feb 19 – Mar 19, 2026

Summary of major changes across the monorepo over the last month.

## 1. Native Bun Bazel Rules (`rules_bun`)

Built a complete custom Bazel rule system for Bun at `tools/rules_bun/`, replacing `aspect_rules_js`/`aspect_rules_ts` and ad-hoc rules in `tools/bazel/`.

- Rules: `bun_library`, `bun_build`, `bun_test`, `bun_typecheck_test`, `bun_eslint_test`, `bun_prisma_generate`
- Hermetic toolchain with multi-platform Bun binaries
- `bun_prepared_tree` for materialized TreeArtifacts preserving monorepo-relative paths
- `bun_vite_build` and `bun_astro_build` macros for framework builds
- Migrated ~40 packages' BUILD.bazel files (reduced size 30-50%)
- New OCI container image rules (`bun_service_image`) with workspace dep handling and layer caching
- Migrated all Docker images to Bazel `oci_image`/`oci_push`

## 2. Kubernetes Resource Management (Kueue)

Solved a cluster stability problem where ResourceQuota caused etcd event storms (FailedCreate retries crashing kube-scheduler).

- Deployed Kueue to suspend jobs instead of rejecting them
- Added ClusterQueue (16 CPU / 64Gi budget) for the buildkite namespace
- Created 3 priority classes: `infrastructure-critical`, `service-standard` (default), `batch-low` (CI)
- Removed the old ResourceQuota approach
- See [decision record](../decisions/2026-03-18_kueue-buildkite-resource-management.md) for details

## 3. Local CI CLI

Built `ci-local` — a Python CLI for running deploy/release workflows locally without Buildkite.

- 12 commands: `homelab-deploy`, `image-push`, `helm-push`, `argocd-sync`, `tofu-apply`, `site-deploy`, `cooklang-release`, `clauderon-release`, `tag-release`, `npm-publish`, `version`, `list-targets`
- Central target catalog (`catalog.py`) replacing hardcoded lists in pipeline_generator
- Dry-run support, auto-generated prerelease versions
- Pipeline generator now finds last green build via Buildkite API (validates ≥40 bazel jobs)
- See [local CI CLI guide](2026-03-18_local-ci-cli.md) for usage

## 4. New Apps & Extensions

- **`packages/glance/`** — SwiftUI macOS menu bar app for homelab monitoring (16+ services: Alertmanager, ArgoCD, Grafana, PagerDuty, etc.)
- **`packages/hn-enhancer/`** — Chrome extension for Hacker News: AI negativity filter (regex + optional Gemini Nano), user blocking, new account filter, reply notifications
- **`packages/tips/`** — Expanded with native macOS notifications and review prompts

## 5. Dotfiles Overhaul

- Replaced LunarVim with minimal Neovim 0.11 config (lazy.nvim, catppuccin, copilot, avante, mini.pick)
- Switched Claude/Gemini/Cursor configs to chezmoi `modify_` templates (merge instead of overwrite)
- Added delta, ripgrep, yt-dlp configs
- Cleaned up fish config

## 6. CLI Tools Expansion (`packages/tools/`)

- **Grafana integration**: alerts, annotations, dashboards, Loki/Prometheus queries
- **PagerDuty integration**: incident and escalation management
- **Bugsink CLI expansion**: events, projects, releases, stacktraces — refactored into modular handlers

## 7. CI Hardening

- Remote cache failures (exit 34/38) now warnings, not fatal
- Increased Bazel JVM memory 8g → 16g
- Build/test timeout 15min → 30min
- Bazel test targets grew from 58 → 78
- Fixed ~8 failing CI jobs on main

## 8. Smaller Changes

- **scout-for-lol**: Lane position icons, updated augment images
- **homelab**: Removed Dagger, fixed namespaces, added monitoring rules
- **docs**: Added guides for local CI CLI and Kueue decision record
