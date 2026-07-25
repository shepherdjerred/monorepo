---
id: log-2026-06-14-renovate-pr-1214-protobufjs-v8
type: log
status: complete
board: false
---

# Renovate PR #1214 — protobufjs v8.3 Tending

## Context

Renovate opened PR #1214 to bump protobufjs from 8.0.3 to 8.3.0 in `packages/birmel` and update the override in `packages/temporal` from `^7.5.7` to `^8.0.0`.

## What Happened

### Greptile P1 Blocker Found

When CI ran, Greptile flagged a P1 (critical) concern on `packages/temporal/package.json:73`:

> **protobufjs v7→v8 override may break Temporal SDK's protobuf layer**
>
> `@temporalio/proto@1.17.2` pins `protobufjs: "7.5.5"` (exact), and
> `proto3-json-serializer@2.0.2` requires `protobufjs: "^7.2.5"`. Forcing
> `^8.0.0` via the bun override would silently replace the v7 build with v8's
> Edition-2024 rewrite and risk encoding/decoding failures in Temporal's
> payload serialization layer.

The CI `Greptile Review` step (in `scripts/ci/src/wait-for-greptile.ts`) checked
for unresolved Greptile threads and failed hard with exit code 1, blocking the
Quality Gate.

### Root Cause

The `packages/temporal` override `protobufjs: "^7.5.7"` was added in commit
`9c3fe7d08` (`fix(root): resolve trivy dependency findings`) as a security pin
to upgrade a vulnerable older protobufjs. It is intentionally v7; the Temporal
SDK's transitive deps (`@temporalio/proto`, `proto3-json-serializer`) are only
tested against v7. Renovate mistakenly treated it as a normal dep bump candidate.

### Fix Applied

Created a fix commit on the `renovate/protobufjs-8.x` branch:

- Reverted `packages/temporal/package.json` override: `^8.0.0` → `^7.5.7`
- Ran `bun install` (without `--frozen-lockfile`) to regenerate `packages/temporal/bun.lock` with `protobufjs@7.6.4` (latest v7)
- Committed as `fix(temporal): keep protobufjs override at ^7.5.7 — v8 incompatible with Temporal SDK`

The fix was pushed to the remote branch.

### Result

- Build #4229 ran with the fix commit and all critical gates passed:
  - `mag-greptile-review` — PASSED (6 seconds, 0 unresolved threads)
  - `shield-quality-gate` — PASSED
  - `white-check-mark-ci-complete` — PASSED
  - `scissors-knip` — Soft failed (expected, known soft failure)
- The build was partially canceled by the user (during docker-build phase), but CI Complete had already passed
- Renovate auto-merged the PR at 07:48:56 UTC via squash merge
- The merge commit (`08c81ef5d`) included both the original birmel bump AND my fix for temporal
- Main now has `protobufjs: "^7.5.7"` in temporal with `protobufjs@7.6.4` resolved in the lockfile

## Net Effect of PR on Main

| Package                                 | Before                    | After                     |
| --------------------------------------- | ------------------------- | ------------------------- |
| `packages/birmel` protobufjs            | 8.0.3                     | 8.3.0                     |
| `packages/temporal` protobufjs override | `^7.5.7` (resolves 7.5.7) | `^7.5.7` (resolves 7.6.4) |

The birmel bump is correct. The temporal override is preserved at v7 as originally intended.

## Session Log — 2026-06-14

### Done

- Investigated PR #1214 (protobufjs 8.0.3 → 8.3.0)
- Identified Greptile P1 blocker: temporal override change `^7.5.7` → `^8.0.0` risks breaking Temporal SDK serialization
- Created worktree at `.claude/worktrees/pr-1214-fix` on `renovate/protobufjs-8.x` branch
- Fixed `packages/temporal/package.json`: reverted override to `^7.5.7`
- Regenerated `packages/temporal/bun.lock` with `protobufjs@7.6.4`
- Committed (`aed2f13f9`) and pushed fix to remote branch
- CI build #4229 ran and all blocking gates passed (Greptile, Quality Gate, CI Complete)
- PR #1214 merged by Renovate as squash merge (`08c81ef5d`) including the fix

### Remaining

- None. The PR is merged with the correct state on main.

### Caveats

- Renovate will likely re-open a PR to upgrade temporal's protobufjs override to v8 in the future; it should be blocked until `proto3-json-serializer@3.x` and `@temporalio/proto` announce protobufjs v8 support
- The PR build #4229 was manually canceled by the user during docker-build phase, but the critical Quality Gate had already passed before the cancel
- A subsequent Renovate push happened on the branch (`bca5ef7fc`) after our fix, but the PR was already merged
