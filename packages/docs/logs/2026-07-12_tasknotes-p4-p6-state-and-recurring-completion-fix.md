# TaskNotes: P4/P6 live-state audit + recurring-completion orphan-date fix

## Status

In Progress — the recurring-completion bug fix is code-complete and verified on
`fix/tfo-recurring-completion-date`; P4/P6 findings are recorded for the operator.

Origin: a "what's left for P4/P6, can we do it?" question that turned into a live
audit, then surfaced a real completion bug while checking recurring-task behavior.
Plan/rework context: `packages/docs/plans/2026-07-03_tasknotes-first-in-class.md`.

## Part A — P4/P6 live-state audit (read-only, prod `tasknotes` ns)

Ran read-only checks against the running pod (image `2.0.0-5487` = P3 code, 2/2, 0 restarts):

- **P3 auto-deployed cleanly.** `GET /api/engine-status` → `{tasks: 208, skippedFiles: []}`.
  Nothing is invisible; no data loss. The scary part of P4 (legacy tasks going
  invisible under the new engine) never materialized — the GitOps auto-deploy of
  P3 landed fine without the planned backup→migrate→audit ceremony.
- **Vault migration never ran**: no `_tasknotes/` side-store, no `.migrated` marker,
  36 files still carry old-server injected `id:` keys (e.g. `id: tasknotes-tasks-…`).
- **Audit gate** (`vault-audit.ts /vault`) → 0 skipped, **155 round-trip diffs**, exit 1.
  Characterized the diff on real files: it is **purely YAML quote-style on `dateModified`**
  (`'…Z'` → unquoted). Semantically identical. Plugin-native files round-trip
  byte-clean, proving default config matches this vault (no field-mapping ping-pong).
- **`migrate-vault.ts` scope is narrow** (`isOldServerTaskFile` gates on an injected
  `id:`): it only rewrites the ~36 id-bearing files. So even post-migration the audit
  won't fully green (~119 benign quote diffs remain; `dateModified` is rewritten on
  every edit anyway).
- **`configSource: defaults`** — the plugin's `.obsidian/plugins/tasknotes/data.json`
  is not synced into the vault, so the server runs on default config. Fine today;
  latent gap if custom statuses/field-mappings are ever added in the plugin.

**Verdict:** P4 is effectively done (deploy is live and correct); only optional
cosmetic tidy remains (strip 36 dead `id:` keys, backup-gated). **P6** (delete the
`/legacy` adapter + migrate the app/server off the legacy `tasknotes-types` index →
`/v2`, ~700–800 LOC) is the real remaining work and is safe now — the iPhone app is
confirmed on the P5 (v2 `/api`) build, so nothing consumes `/legacy`. Full write-up
in the harness plan `~/.claude/plans/ok-what-s-left-for-staged-noodle.md`.

## Part B — Recurring-completion orphan-date bug (fixed)

### Symptom (found in live data)

The user completed two recurring tasks (`pay-rent`, monthly on the 1st;
`pay-airvpn`, monthly on the 20th) on 2026-07-12. Both files recorded
`complete_instances: [..., "2026-07-12"]` — but the model only reads an occurrence
as done when that occurrence's OWN date is in `complete_instances`. Since `07-12` is
neither the 1st nor the 20th, `getEffectiveTaskStatus` still returns `open` for
every real occurrence: airvpn shows unchecked again on 07-20, rent on 08-01. The
completions were silently orphaned. `pay-rent`'s history (`03-03`, `03-14`) shows it
had **never** registered an occurrence as done.

### Root cause

`TaskContext.toggleStatus` and `TaskRow`'s checkbox both hardcoded `localTodayYmd()`
as the recurring instance date. That is only correct when you complete on the
occurrence day (the Today view enforces this via `occursOn(today)`), but the app's
Inbox/Browse/Upcoming/Detail views show recurring tasks regardless of date — so a
tap there recorded today and never lined up with an occurrence.

### Fix (3 files, delegates to the model)

- `src/domain/recurrence.ts`: new `completionTargetDate(task)` — mirrors the plugin's
  `getRecurringTaskActionDate`/`resolveOperationTargetDate`: target the SCHEDULED
  occurrence (`scheduled ?? due ?? today`), or today for completion-anchored rules.
- `src/state/TaskContext.tsx`: `toggleStatus` dispatches `set_instance_complete` with
  `completionTargetDate(existing)` instead of `today` (both `date` and the
  `completed` set-value).
- `src/components/task/TaskRow.tsx`: checkbox reads `isCompletedOn(task,
completionTargetDate(task))` for recurring tasks, so the checkbox and the toggle
  always agree on which occurrence they act on.
- `src/domain/recurrence.test.ts`: 4 new tests incl. a regression encoding the exact
  scenario (monthly-on-20th, tap on the 12th → targets 07-20, not 07-12).

No per-screen threading was needed: the app is a task list, and the plugin completes
the `scheduled` instance from lists too.

### Verification (worktree `fix/tfo-recurring-completion-date`)

- `bun run typecheck` — clean.
- `bun run test` — 273 pass / 0 fail (17 files); recurrence suite 21 pass.
- `bunx eslint` on the 4 changed files — clean.
- Maestro e2e is a local-only gate (no macOS CI) — not run this session.

## Session Log — 2026-07-12

### Done

- Read-only P4/P6 live audit (findings above); no live mutations.
- Fixed the recurring-completion orphan-date bug in `packages/tasks-for-obsidian`
  (`recurrence.ts`, `TaskContext.tsx`, `TaskRow.tsx` + tests); verified green.

### Remaining

- Open the PR for `fix/tfo-recurring-completion-date` (pending user go-ahead) and a
  TestFlight build afterward.
- **User-owned:** repair the already-orphaned `complete_instances` entries in the
  vault (retag `2026-07-12`, rent's `03-03`/`03-14` → correct occurrence dates).
- Optional P4 `id:` tidy (backup-gated) + P6 cleanup PR — both tracked in the plan.

### Caveats

- The fix targets the `scheduled` instance. For tasks whose `scheduled` has already
  drifted from the orphaned data (e.g. `pay-rent` scheduled=08-01 while 07-01 is
  overdue), completing will target 08-01 until the user repairs the data — expected,
  not a fix regression.
- Maestro e2e not run (local macOS gate); recommend a local pass before merge.
