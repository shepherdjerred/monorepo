# Docker/Helm/Infra-Tool Dependency Bump PR

## Status

Complete

## Context

User asked to review the Renovate Dependency Dashboard (issue #481) and open one PR
bumping Docker, Helm, and "etc." infra dependencies — explicitly excluding npm/bun
language dependencies. Clarified scope via AskUserQuestion: include Terraform
providers/CLI tools alongside Docker/Helm, and include major version bumps (not just
minor/patch).

## What was done

- Read the full Dependency Dashboard issue (#481) to enumerate every pending update,
  cross-referenced against the actual pin locations in the repo (not guessed).
- Located every relevant pin: `packages/homelab/src/cdk8s/src/versions.ts` (Helm
  charts + K8s-side Docker images), `.dagger/src/constants.ts` (CI toolchain image/CLI
  pins), `.buildkite/ci-image/Dockerfile` + `.buildkite/scripts/setup-tools.sh`
  (duplicate CI tool pins, intentionally mirrored per the Dockerfile's own comment),
  two `docker-compose.yml`/`compose.yaml` observability stacks, `packages/dotfiles/Dockerfile`,
  and three `.terraform.lock.hcl` files.
- Fetched every real digest via `crane digest` against the live upstream registry
  (ghcr.io, docker.io, registry.dagger.io) rather than hand-typing SHAs — cross-checked
  against the dashboard's own short-SHA hints where given (all matched).
- Regenerated the three touched `.terraform.lock.hcl` files with `tofu init -upgrade`
  instead of hand-editing hashes.
- Hit a real breaking change: `grafana/tempo` v3.0.2 removes/restructures the
  `ingester` config key. Verified with `tempo -config.verify=true` against both
  v3.0.2 (fails) and the same-major 2.10.6 patch (passes) — shipped 2.10.6 instead
  of the major, documented the deviation in the PR body.
- Verified end-to-end: `bun run typecheck`, full `bun run test` in homelab (cdk8s
  synth + helm-template render + GPU resource tests), `bun scripts/check-dagger-hygiene.ts`,
  `tofu validate` on all three touched provider stacks, and the full pre-commit hook
  suite (1Password item lint, Helm chart lint across 29 charts, quality ratchet,
  gitleaks).
- Opened PR #1431: https://github.com/shepherdjerred/monorepo/pull/1431

## Scope decisions (from AskUserQuestion)

- Included Terraform providers/OpenTofu/CLI binary tools alongside Docker/Helm.
- Included major version bumps where safe (verified individually, not blanket-applied).

## Excluded, with rationale

- `siderolabs/talos` — team policy is notify-only for Talos/K8s version pins (see
  `feedback_talos_kube_notify_only_pins` memory); already has open PRs #1426/#1427.
- `shepherdjerred/scout-for-lol/prod` and `shepherdjerred/starlight-karma-bot/prod` —
  these are self-referential app-promotion tags (our own CI-built images), not
  third-party dependencies; bumping them is a deploy decision, not a dep update.
- All npm/bun-datasourced entries (React, TypeScript v7, ESLint, OpenTelemetry JS,
  Babel v8, etc.) — explicitly out of scope per the user's request.
- `grafana/tempo` v3.0.2 major — breaking config change, needs its own migration PR;
  shipped the 2.10.6 patch instead (see above).
- `alpine/helm:4.2.3` Docker image — tag doesn't exist upstream yet (404 via
  `crane digest`), only the `helm/helm` GitHub-release CLI binary pin was bumped.

## Session Log — 2026-07-09

### Done

- PR #1431 opened: `chore(deps): bump Docker/Helm/infra-tool versions`
  (branch `chore/docker-helm-infra-updates`, worktree
  `.claude/worktrees/deps-docker-helm`)
- 10 files changed: `packages/homelab/src/cdk8s/src/versions.ts`,
  `.dagger/src/constants.ts`, `.buildkite/ci-image/Dockerfile`,
  `.buildkite/scripts/setup-tools.sh`, `packages/dotfiles/Dockerfile`,
  `scripts/observability/local-stack/docker-compose.yml`,
  `packages/llm-observability/test/e2e/compose.yaml`, and three
  `.terraform.lock.hcl` files (buildkite, github, seaweedfs/aws)
- All verification green: typecheck, homelab test suite, dagger hygiene,
  tofu validate, full pre-commit hook chain

### Remaining

- PR #1431 needs CI (Buildkite) to pass and human review/merge — not monitored in
  this session per no explicit ask to babysit it through CI.
- A follow-up PR for the `grafana/tempo` v2→v3 migration (config schema changes)
  was flagged but not started.
- The two already-open PRs (#1426 Talos, #1427 installer digest) were left alone as
  requested by team policy — not touched or merged in this session.

### Caveats

- The worktree at `.claude/worktrees/deps-docker-helm` (branch
  `chore/docker-helm-infra-updates`) is still present; remove it and the local
  branch after the PR merges per the standard worktree cleanup step.
- `bun install` during `scripts/setup.ts` incidentally drifted
  `packages/temporal/bun.lock` (unrelated lockfile metadata churn) — reverted before
  committing; if this happens again on a `main` update, it's expected bun-install
  noise, not a real dependency change.
