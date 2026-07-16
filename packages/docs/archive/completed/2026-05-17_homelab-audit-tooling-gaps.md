# Homelab Audit Tooling Gap Remediation

## Status

Complete — audit-tooling code (Buildkite/Temporal CLIs, preflight, S3 archive) shipped and running in the daily audit.

## Summary

Fix only the audit tooling gaps surfaced in the May 13-17 homelab audit emails. The implementation will improve the audit worker image, preflight checks, Bugsink/Grafana/Buildkite/Temporal visibility, S3 audit archiving, and read-only RBAC coverage without remediating the service findings themselves.

## Implementation Plan

- Add missing `bk` and `temporal` CLIs to the Temporal worker image with pinned versions and build-time smoke checks.
- Add a preflight activity before the audit agent so missing local tooling and required secrets fail clearly, while remote API/tool failures are injected into the audit prompt as warnings.
- Archive generated audit Markdown and rendered HTML to S3 before sending the email, then archive message metadata after Postal accepts the email.
- Update the audit prompt and runbook so Prometheus firing alerts are primary, Grafana-managed rules are explicitly secondary, Bugsink project filters match toolkit behavior, and Temporal uses direct CLI access through `TEMPORAL_ADDRESS`.
- Keep audit RBAC read-only while adding only the Tailscale CRDs the runbook reads.

## Session Log — 2026-05-17

### Done

- Created this implementation plan document.
- Added pinned `bk` and `temporal` CLI installs to the Temporal worker image, including checksum verification and build-time version smoke checks.
- Added homelab audit preflight support: required binary/secret checks fail fast, and remote/tool access warnings are injected into the audit prompt.
- Added S3 audit archiving: Markdown and rendered HTML are uploaded before email send, and metadata JSON is uploaded after Postal accepts the email.
- Updated audit workflow ordering to run preflight, run the agent, archive body, send email, then archive metadata.
- Updated audit prompt/runbook language for `bk`, `temporal`, direct `TEMPORAL_ADDRESS`, Prometheus `ALERTS{alertstate="firing"}` as primary, Grafana-managed-rule-only `toolkit gf alerts`, Cloudflare checkout prerequisites, and Bugsink project filtering.
- Fixed Bugsink toolkit URL normalization and slug project filtering for issues/releases, with regression tests.
- Updated Temporal worker environment for Buildkite, Bugsink public URL, and audit archive settings.
- Kept audit RBAC read-only and added read-only Tailscale CRD access for runbook queries.
- Added cdk8s assertions for worker env and RBAC shape.
- Extracted reusable S3 PUT support from the fetcher activity for audit archive reuse.
- Verified with:
  - `bunx eslint . --fix` in `packages/temporal`
  - `bunx eslint . --fix` in `packages/toolkit`
  - `bunx eslint . --fix` in `packages/homelab/src/cdk8s`
  - `bun run --filter='./packages/temporal' typecheck`
  - `bun run --filter='./packages/toolkit' typecheck`
  - `bun run --filter='./packages/homelab/src/cdk8s' typecheck`
  - `bun run --filter='./packages/temporal' test` (rerun outside sandbox for local Temporal/Bun servers)
  - `bun run --filter='./packages/toolkit' test:unit`
  - `bun run --filter='./packages/homelab/src/cdk8s' test`
  - `dagger call build-temporal-worker-image --pkg-dir ./packages/temporal --dep-names eslint-config --dep-dirs ./packages/eslint-config --dep-names home-assistant --dep-dirs ./packages/home-assistant --dep-names toolkit --dep-dirs ./packages/toolkit sync`
  - `git diff --check`

### Remaining

- Roll out the new worker image through the normal GitOps/image flow.
- After deploy, manually trigger `homelab-audit-daily` and confirm the email plus S3 Markdown/HTML/metadata archive objects exist.
- Confirm the next live audit no longer reports missing `bk`, Temporal CLI/pods-exec gaps, Bugsink host failures, Grafana managed-alert confusion, or missing Cloudflare checkout as tooling gaps.

### Caveats

- Scope remains audit tooling only; HA/NVMe/redlib/PDB/backups service findings are intentionally not remediated here.
- The full Temporal test initially failed inside the sandbox because it could not start local Temporal/Bun test servers; it passed after rerunning with the required local server permissions.
- The local Dagger image build completed and smoke-tested `bk --version` and `temporal --version`, but no image was pushed and no live cluster mutation was performed.
- `git status` and diff commands reported a local fsmonitor IPC warning for this worktree, but the commands still completed.
