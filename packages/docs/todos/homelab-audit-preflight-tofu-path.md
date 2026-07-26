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

- [ ] Decide the intended source tree for the bespoke rollback audit's
      preflight: clone a fresh checkout (mirroring `bot-clone.ts` /
      `agentTaskWorkflow`) before the tofu check, or drop the in-image
      Cloudflare drift check and lean fully on the generic-clone path.
- [ ] Implement, and make the preflight path resolution explicit (repo-root
      parameter or cloned-workdir parameter) instead of CWD-relative.
- [ ] Confirm one live `homelab-audit-daily` run reports the Cloudflare drift
      section (or its removal is documented in the runbook).

## Comment Log

- 2026-07-25: Filed from the PR #1668 review cycle (docker image slimming);
  behavior verified pre-existing via CWD analysis, not a regression of the
  scoped-COPY images.
