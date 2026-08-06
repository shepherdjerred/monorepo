---
id: reference-completed-2026-05-10-docs-grooming-plans-logs-split
type: reference
status: complete
board: false
---

# Docs Grooming: split plans/logs + audit, status-verify, consolidate, link-check

## Status Notes (Historical)

## Context

`packages/docs/plans/` has accumulated 40 files because `monorepo/CLAUDE.md` ("Documentation Discipline — Per Session") forces a plan file for every session, even one-shot edits. The user wants:

1. A new **`logs/`** dir for session journals; plans become less frequent.
2. **Broader grooming** of all `packages/docs/`: staleness audit of guides/decisions, verify `Status: Complete` claims against the codebase, consolidate archive subdirs, scan broken links, flag missing coverage.
3. Run audits + execution **in parallel via subagents**.

Categorization of current 40 plans (from prior Explore pass): ~16 real PLANs · ~3 pure LOGs · ~21 MIXED.

## Target taxonomy

| Dir                             | Purpose                                                                            | Trigger to write one                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `plans/`                        | Forward-looking design docs (scope, files-to-touch, verification, multi-step work) | Plan mode used, or work is multi-step / has design choices / has follow-ups |
| `logs/` (NEW)                   | Per-session journals: Done / Remaining / Caveats. Thin or no plan substance.       | Default for one-shot fixes, bug recaps, Q&A sessions                        |
| `archive/completed/` (existing) | Plans whose work is done and that had substantive original design                  | When a plan in `plans/` finishes                                            |

**Rule of thumb:** if there was no real planning, write a log. Plans are for sessions where the design itself is the artifact.

## Execution model — parallel subagents in 3 phases

### Phase 1 — Parallel audits (4 Explore agents, read-only)

Launched in a single message:

| Agent | Scope                                                                                                                                                                                                                                                                                                      | Deliverable                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A1    | Read every file in `guides/` and `decisions/`; flag staleness (references to removed packages/tools, superseded choices, outdated dates).                                                                                                                                                                  | Per-file table: file, current claim, observed reality, recommended action (keep / update / archive). |
| A2    | For every doc in `plans/`, `decisions/`, `archive/completed/` that claims `Status: Complete` or `Implemented`, verify the feature/package/script still exists.                                                                                                                                             | List of stale `Complete`-claim docs with the missing artifact named.                                 |
| A3    | Walk `archive/` subdirs (bazel, dagger-migration, on-hold, stale, superseded, homelab-audits, scout-followups, changelogs, completed); flag candidates for delete vs merge vs keep. Also identify near-duplicates in active dirs (e.g. multiple PR-review-bot phase plans, multiple homelab audit guides). | Per-subdir summary + near-duplicate clusters with merge suggestions.                                 |
| A4    | Scan every Markdown file in `packages/docs/` for broken in-repo links. Compare `packages/` directory listing against `index.md` Architecture/Guides coverage; flag packages with zero docs.                                                                                                                | Two lists: (a) broken links with file:line, (b) packages lacking docs.                               |

### Phase 2 — Synthesize (me, sequentially)

- Read all 4 audit reports.
- Per-file decision matrix: keep / update / move to `logs/` / move to `archive/completed/` / move to existing archive subdir / delete (rare; only with explicit user OK).
- Resolve collisions (a file flagged by multiple agents).
- Update this plan file with the final per-file disposition.
- Decide whether anything material needs user re-approval before execution (e.g. deletions, big consolidations).

### Phase 3 — Parallel execution (3 general-purpose agents on non-overlapping workstreams)

Strict file scoping to prevent collisions. Cross-cutting files (`CLAUDE.md`, `packages/docs/CLAUDE.md`, `packages/docs/index.md`) are handled by me at the end, not by any agent.

| Agent | Workstream                                                                                                                                                                                                          | Files in scope                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| E1    | **Plans/logs split.** Create `the former session-journal directory` (with `.gitkeep`). `git mv` log-style files from `plans/` → `logs/`. `git mv` completed substantive plans from `plans/` → `archive/completed/`. | Only files under `packages/docs/plans/`, `the former session-journal directory`, `packages/docs/archive/completed/`. |
| E2    | **Guides/decisions staleness + status sweep.** Apply per-file actions from A1 + A2 reports: edit stale guides/decisions in place where small; `git mv` to archive for big ones.                                     | Only files under `packages/docs/guides/`, `packages/docs/decisions/`, and the target archive subdirs.                |
| E3    | **Archive subdir consolidation + broken-link fixes.** Merge/delete inside `archive/` per A3. Fix broken in-repo links per A4 (rewriting paths inside doc bodies; not moving files).                                 | Only files under `packages/docs/archive/`. Link fixes touch any doc but only edit link text.                         |

After E1–E3 return:

- **Me (sequential):** rewrite `/Users/jerred/git/monorepo/CLAUDE.md` "Documentation Discipline" section, `packages/docs/CLAUDE.md` structure block, and rebuild `packages/docs/index.md` to reflect the final state. Add `## Logs` section linking only the dir (per earlier decision).
- Capture "missing-docs" findings from A4 as a follow-up plan stub (NOT executed this session) in `plans/`.

## Doc edits (cross-cutting, me-owned)

### `/Users/jerred/git/monorepo/CLAUDE.md` — "Documentation Discipline — Per Session"

This historical change replaced the earlier mandatory-plan framing with:

- **Write a plan** at `packages/docs/plans/...` only when (a) plan mode was used, or (b) work is multi-step / has design choices / introduces follow-ups. Mirror harness plans into `plans/` in that case.
- The then-current end-of-session summary rule remained unchanged: it required
  Done / Remaining / Caveats in the produced file and final chat response.
- Drop "even one-shot edits must produce a plan".

### `/Users/jerred/git/monorepo/packages/docs/CLAUDE.md`

- Add `logs/` to the structure block.
- Add a row to "Where to Put New Docs": Type "Per-session journal" → `logs/` → examples "Bug-fix recaps, one-shot edits, Q&A sessions".
- Add a one-line "Plan vs Log" disambiguation using the rule of thumb above.

### `/Users/jerred/git/monorepo/packages/docs/index.md`

- Insert `## Logs` between `## Plans` and `## Guides`. Single bullet linking the directory only.
- Remove entries from `## Plans` for any plan that moved.
- Update archive subdir counts to match new state.

## Verification

- `ls packages/docs/plans/ | wc -l` drops to roughly the count of still-active PLANs (~20 max, target ~16).
- `ls the former session-journal directory` populated; `git log --diff-filter=R --name-status` shows renames (preserves history via `git mv`).
- `archive/completed/` grew by the substantive-completed plans.
- `bunx markdown-link-check` (or equivalent grep for broken `[...](./...)` paths) returns clean on `packages/docs/**`.
- `packages/docs/index.md` no longer references any moved file; `## Logs` dir link resolves.
- Per-file: read the first 20 lines of each moved file to confirm no self-referential broken paths remain.

## Constraints / safety

- **All file moves use `git mv`** to preserve history.
- **Subagents must not `git checkout`, `git stash`, `git switch`, or modify branches** — explicit prohibition in each agent prompt. (Per `feedback_subagents_no_checkout`.)
- **Subagents stay strictly within their scoped file roots** to avoid collisions on `index.md`, `CLAUDE.md`, etc. — these are me-only.
- **No deletions without explicit user OK** in Phase 2 synthesis. Default is `git mv` to archive.
- Read every "move to logs" candidate first; reclassify if it has accumulated real plan substance.

## Out of scope (deferred)

- Re-styling archived docs.
- Editing `/Users/jerred/CLAUDE.md` (global) — the discipline rule lives in monorepo CLAUDE.md.
- Implementing fixes for the "packages with no docs" findings — surfaced as a follow-up plan only.
