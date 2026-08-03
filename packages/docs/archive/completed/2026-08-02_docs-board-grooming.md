---
id: plan-2026-08-02-docs-board-grooming
type: plan
status: complete
board: false
---

# Groom the Markdown docs board

## Goal

Reconcile every `board: true` document with current repository and live-system
evidence, complete deterministic follow-ups, archive finished work, and leave
only genuine implementation, operator, or human-acceptance work active.

## Remaining

- [x] Inventory all board items and their current workflow metadata.
- [x] Resolve safe mechanical PR, CI, deployment, and verification checks.
- [x] Archive completed plans and TODOs.
- [x] Correct stale status, verification, disposition, and document placement.
- [x] Run docs validation and publish the grooming change for review.

## Session Log — 2026-08-02

### Done

- Audited all 127 starting board cards through live PR, Buildkite, ArgoCD,
  Kubernetes, Temporal, package-registry, and repository evidence.
- Reduced the active board to 109 cards while adding three narrowly scoped
  follow-ups, for a net removal of 18 stale or completed cards.
- Archived completed implementation and acceptance records, including
  SeaweedFS capacity, deterministic Bindery identity, Data Dragon robustness,
  PR-bot removal, dependency phases, CI reporting, CI base pins, MK64 Worker
  performance, Pokémon reliability, and owner-accepted UAT.
- Split privileged or externally gated residuals into dedicated cards for the
  orphaned Temporal listener, VoltAgent/AI SDK compatibility, and
  current-topology NVMe maintenance revalidation; left the concurrent MK64 A/V
  defect with the user's existing card.
- Corrected board placement for partially completed operator work, active
  controller hardening, Scout review-eval input blocking, Argo prune policy,
  Home Assistant Econet recovery, Syncthing relay acceptance, and other live
  follow-ups.
- Preserved active defects where merge alone was insufficient: missing wiki
  security headers, three unresolved PR-fleet controller findings, Scout
  resilience production promotion, and first post-deploy scheduled-run checks.
- Passed Prettier and `bun run check-todos` across 1,113 Markdown documents.

### Remaining

- None.

### Caveats

- The main checkout's concurrent user-owned changes were preserved and copied
  only where the owner had already recorded explicit completion transitions.
- Destructive or credentialed operator actions were not performed: GHCR
  deletion, Temporal workflow termination, retained storage deletion, schedule
  unpause, and production UI/API replays remain blocked on explicit authority.
- The newest unrelated main Buildkite build was still running during the audit;
  closures use exact feature-head CI plus independent deployed evidence rather
  than treating that moving aggregate as their oracle.
