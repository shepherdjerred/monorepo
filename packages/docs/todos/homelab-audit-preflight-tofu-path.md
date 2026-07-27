---
id: homelab-audit-preflight-tofu-path
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-25_docker-image-optimization.md
source_marker: false
---

# homelab-audit preflight resolves the Cloudflare tofu module relative to the worker CWD, so it never resolves in-image

## Problem

`packages/temporal/src/activities/homelab-audit-preflight.ts` checks and runs
the Cloudflare drift module via the RELATIVE path
`packages/homelab/src/cdk8s/src/tofu/cloudflare` (`await access(...)` and
`tofu -chdir=...`). The temporal-worker process starts with
`WORKDIR /app/packages/temporal` (image CMD `bun src/worker.ts`; no cdk8s
`workingDir` override), so the path resolves to
`/app/packages/temporal/packages/homelab/...` — a location that has **never
existed**, in the old `COPY . .` image (tree at `/app/packages/homelab`) or in
the slim scoped image (tree absent entirely). The preflight therefore always
degrades to its "Cloudflare tofu module path is missing" warning and the
in-image (bespoke rollback) audit path omits the Cloudflare drift check.

Surfaced by a Codex review comment on PR #1668, which read it as a
slim-image regression; the CWD analysis shows it is pre-existing behavior
independent of the image layout. The primary `homelab-audit-daily` path is
unaffected: it runs through the generic `agentTaskWorkflow`, which clones the
monorepo into `/tmp` and runs against that checkout, where the relative path
resolves.

## Remaining

- [ ] Make the bespoke rollback audit clone/use an explicit repository root, matching `agentTaskWorkflow`, before running Cloudflare drift checks.
- [ ] Replace the invalid `packages/homelab/src/cdk8s/src/tofu/cloudflare` path with the actual `packages/homelab/src/tofu/cloudflare` module resolved from that root.
- [ ] Add tests that run from a non-repository CWD and fail clearly when the checkout or module is absent.
- [ ] Confirm one live `homelab-audit-daily` run reports the Cloudflare drift
      section from the cloned checkout.

## Comment Log

- 2026-07-25: Filed from the PR #1668 review cycle (docker image slimming);
  behavior verified pre-existing via CWD analysis, not a regression of the
  scoped-COPY images.
- 2026-07-27 — Board audit confirmed the code still combines an invalid doubled
  `src/cdk8s/src/tofu` path with CWD-relative resolution. The primary generic
  workflow's clone does not make the bespoke preflight correct; both assumptions
  are now explicit acceptance criteria.
