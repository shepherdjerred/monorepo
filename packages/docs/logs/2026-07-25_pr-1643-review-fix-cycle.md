---
id: log-pr-1643-review-fix-cycle-2026-07-25
type: log
status: complete
board: false
---

# PR #1643 review and fix cycle

## Scope

- Inspect current PR health and direct mergeability.
- Replace the unavailable Greptile review with `codex review --base origin/main`.
- Address at most the top real P3+ defect while preserving the accepted placeholder-digest decision.
- Resume against the hosted Codex review on commit `15b6d29ac`, address all
  four current-head findings, and use the hosted threads as the sole review
  oracle for the follow-up.

## Review result

Codex reported two P1 observations that restated the accepted first-push risk:
the all-zero seed digest and the new GHCR package's initial private visibility.
Those were already documented in the implementation plan and were not changed.

Codex also found one independent P2 defect: the package-local
`docker:build` aggregate omitted Bindery, so Turbo's `smoke` dependency could
exercise a missing or stale `bindery:dev` image. Added
`docker:build:bindery` and included it in the aggregate.

The hosted follow-up review correctly rejected deploying the all-zero seed.
PR #1643 now publishes the patched image without switching the workload:
`vavallee/bindery` remains the rendered media image while main CI seeds the
unused first-party pin. The switch is a later change, gated on a real digest
and anonymous GHCR access. The same follow-up moved the frontend build to Bun,
forwarded release metadata through Bake, and updated the canonical ebook guide.

## Verification

- `toolkit pr health 1643 --json`: branch reported behind `main`; the wrapper
  did not surface the live Buildkite checks.
- `git merge-tree --write-tree --quiet origin/main HEAD`: exit 0.
- `codex review --base origin/main`: reviewed the complete PR diff; the one
  independent P2 finding was fixed.
- `cd packages/homelab && bun run docker:build:bindery`: passed, including
  `TestAddBook_AuthorlessGoogleBooks`.
- `cd packages/homelab && bun scripts/smoke-images.ts bindery`: Bindery passed
  `/api/v1/health`; the runner does not accept a target filter and also attempted
  four sibling images that were not materialized in this focused cycle.
- `bun run verify -- --affected`: passed (25 tasks).
- `bun run docker:build:bindery`: passed with Bun frontend install/build and
  the patched Go test.
- `VERSION=1643 GIT_SHA=15b6d29ac8b4025c755655d1e8f34413b3299606
docker buildx bake bindery --load`: passed; build log showed both values in
  the Go linker flags.
- Bindery container smoke: `/api/v1/health` returned
  `{"status":"ok","version":"1643"}`.
- CDK8s `typecheck`, `lint`, and `build`: passed; rendered
  `media.k8s.yaml` uses the real upstream digest and does not consume the
  all-zero staging pin.
- Targeted Markdown lint, Prettier, and Docker image digest validation: passed.

## Session Log — 2026-07-25

### Done

- Confirmed PR #1643 is directly mergeable with current `origin/main`.
- Replaced the unavailable Greptile review with the Codex CLI review.
- Fixed the package-local Bindery image-build omission in
  `packages/homelab/package.json`.
- Addressed all four hosted Codex findings on commit `15b6d29ac`.
- Converted the Bindery frontend stage from npm/Node to Bun.
- Passed CI release metadata into the Bindery binary through Bake.
- Restructured PR #1643 as publication-only so the placeholder cannot reach a
  workload.
- Updated the canonical ebook-stack guide and implementation plan with the
  staged rollout.

### Remaining

- Let fresh Buildkite checks evaluate the pushed commit.
- After merge, let main CI publish the image and seed its real digest, make the
  package public, verify anonymous pull, then open the deployment-switch
  follow-up.

### Caveats

- `ghcr.io/shepherdjerred/bindery` does not exist before the first main image
  push; the staging pin is deliberately unused by the Deployment.
- The Chinese-add behavior cannot be exercised in the live Bindery UI until
  the post-publication switch is merged.
