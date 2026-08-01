---
id: log-2026-07-30-codex-sandbox-danger-full-access
type: log
status: complete
board: false
---

# Fix Codex `--sandbox` bwrap failure inside the temporal-worker pod

## Summary

The recurring `ci-io-post-merge-impact` Codex agent-task
(`packages/docs/plans/2026-07-19_ci-io-optimization.md`) was failing on every
run with `bwrap: No permissions to create a new namespace`. Root cause: Codex
CLI enforces any `--sandbox` value other than `danger-full-access` via
bubblewrap on Linux, which needs to create a new user/mount namespace. The
`temporal-worker` Kubernetes pod runs unprivileged and non-root, so the
nested namespace creation is refused and `codex exec` never runs a single
command. This matches [openai/codex#16211](https://github.com/openai/codex/issues/16211)
and OpenAI's own guidance for containerized/CI environments: let the
container be the isolation boundary and run with `--sandbox danger-full-access`
instead of nesting a second sandbox inside it.

Repo-wide audit found two call sites with this bug, both invoked from the
`temporal-worker` pod:

1. `packages/temporal/src/activities/agent-task-command.ts` (`codexCommand()`)
   — every scheduled Codex-provider report-only agent task. This is the one
   observed failing in production (the `ci-io-post-merge-impact` schedule;
   `pvc-backup-policy-zfs-cleanup` uses the same code path).
2. `README.md`'s embedded `[[[cog ... ]]]` block, invoked via `cog -r` from
   `packages/temporal/src/activities/readme-refresh.ts` — only fires when a
   brand-new package has no committed `_summary.md` yet, so it was silently
   broken without being noticed.

Confirmed **not** affected (already use `--dangerously-bypass-approvals-and-sandbox`,
audited and left unchanged): `scripts/lib/release-refiner.ts`,
`packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.ts`.
`packages/code-review/src/providers/codex.ts` and
`.buildkite/scripts/smoke-app-in-image.ts` don't invoke a sandboxed `codex exec`
at all.

## Fix

Changed `--sandbox read-only` → `--sandbox danger-full-access` in both call
sites, with an inline comment explaining why (each references the other for
context). No behavioral change beyond removing Codex's own OS-level
filesystem/network restriction — the pod (ephemeral, non-root, throwaway
per-run clone, `mode: "report-only"` prompt constraint) remains the real
isolation boundary, matching the pattern already used elsewhere in the repo.

## Verification

- `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`
- `bunx lefthook run pre-commit`
- No live end-to-end repro possible locally (needs the exact unprivileged
  container environment + `CODEX_API_KEY`). Real proof is the next scheduled
  fire of `ci-io-post-merge-impact` / `pvc-backup-policy-zfs-cleanup`
  succeeding in prod after this deploys (merge → CI builds/smokes/pushes the
  `temporal-worker` image → ArgoCD syncs) — noted in the PR as the follow-up
  signal to watch.

## Session Log — 2026-07-30

### Done

- Diagnosed the `ci-io-post-merge-impact` Codex agent-task failure
  (`bwrap: No permissions to create a new namespace`) to Codex CLI's
  bubblewrap-based OS sandbox failing inside the unprivileged
  `temporal-worker` pod, confirmed against upstream OpenAI docs/issue.
- Audited every `codex exec` invocation in the repo for the same pattern.
- Fixed both affected call sites: `packages/temporal/src/activities/agent-task-command.ts`
  and `README.md`'s cog block, switching `--sandbox read-only` to
  `--sandbox danger-full-access`.

### Remaining

- Watch the next fire of `ci-io-post-merge-impact` (daily) and
  `pvc-backup-policy-zfs-cleanup` after this PR deploys to confirm the fix
  actually resolves the runtime failure (can't be verified locally).

### Caveats

- `danger-full-access` removes Codex's own filesystem-write guard inside its
  process; report-only enforcement (no PR/issue mutation) remains prompt-level
  only, as it already effectively was. The workdir is a throwaway per-run
  clone in an ephemeral pod, so this is a low-severity trade, not a new
  exposure.
