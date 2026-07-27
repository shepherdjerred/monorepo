---
id: log-2026-07-26-pr-1700-glitter-shared-context
type: log
status: complete
board: false
---

# PR #1700 — resolve Codex findings on `feature/glitter-shared-context`

Worked PR #1700 (glitter shared-context centralization + weekly refresh) toward
green CI. The only red job was `robot-face-review-gate`; all PR verification jobs
(verify, playwright, semgrep, dry-runs) were already green. The gate blocks on 12
unresolved Codex review threads (several duplicated). The gate itself also has a
known bug tracked by fix #1704.

## Findings addressed

| #   | Sev | Area                                                    | Fix                                                                                                                                                                                                                                                |
| --- | --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | P2  | `birmel/src/elections/persona-discord-ids.ts`           | Derive Discord id from shared `getPerson()` data instead of a hardcoded 10-persona map, so every `listStyleCardNames()` candidate resolves a profile id                                                                                            |
| 1,7 | P2  | `temporal/.../glitter-context-refresh-relationships.ts` | Direction-aware endpoint comparison (`endpointList`/`endpointKey`): directed `source-to-target` reversals now supersede instead of silently skipping; proposal id preserves order. Added a directed-reversal test                                  |
| 2   | P1  | `scripts/deploy-site.ts`                                | Glitter site `buildCmd` builds the `glitter-context` producer first (its `dist/` is gitignored) — mirrors the site-scout producer-build pattern                                                                                                    |
| 3   | P1  | `.buildkite/scripts/ci-changed.sh`                      | Added `packages/glitter-context` to `site_glitter_paths` + `site_scout_paths`. Verified the `images` lane already covers it via the workspace closure in `select-image-targets.ts` (probe returned `["birmel","scout-for-lol","temporal-worker"]`) |
| 4,8 | P2  | `glitter-context/python/validate_context.py`            | Pydantic now mirrors canonical constraints: Discord-id/checksum patterns + `AwareDatetime`/`date` for timestamps; added duplicate-Discord-id check (F9 parity). Verified it rejects the cited bad values                                           |
| 5   | P2  | `temporal/.../glitter-context-refresh.ts`               | `updateGenerationState` appends state entries for newly-refreshed people with no prior entry (was mapping existing entries only)                                                                                                                   |
| 9   | P2  | `glitter-context/src/schema.ts`                         | People validator rejects a `discordUserId` assigned to multiple records                                                                                                                                                                            |
| 10  | P2  | `glitter-context/scripts/generate.ts`                   | Index-based import bindings (`styleCard0`…) + quoted object keys so non-identifier person ids can't emit invalid JS; regenerated `generated-data.ts`                                                                                               |
| 11  | P2  | `birmel/package.json`                                   | `dev`/`start` build `@shepherdjerred/glitter-context` first (its `dist/` is gitignored; Docker image already builds it in its build stage, so only local dev was affected)                                                                         |
| 6   | P1  | `homelab/.../temporal/worker.ts`                        | **Operator-blocked** — see below. Filed `todos/glitter-corpus-worker-credentials.md`                                                                                                                                                               |

## F6 — operator-blocked

Wiring the 12 `GLITTER_*` corpus/Discord credentials into the worker requires
those fields to exist in the `temporal-temporal-worker-1p` 1Password item.
Drafting the wiring and running `check:1password` confirmed the fields are absent
from the vault snapshot, so required secret refs turn `check:1password` red (and
the repo forbids `optional: true` secrets). Populating them needs real Discord +
S3/R2 credentials only the operator has. Reverted the wiring to keep CI green and
tracked the full operator step in
`packages/docs/todos/glitter-corpus-worker-credentials.md`. The schedules already
fail-safe: `schedule-state.ts` registers them **paused** while the env is missing.

## Session Log — 2026-07-26

### Done

- Fixed 11 of 12 Codex findings (F0,F1/F7,F2,F3,F4/F8,F5,F9,F10,F11) across birmel,
  temporal, glitter-context, scripts/deploy-site.ts, and .buildkite/ci-changed.sh.
- Added a directed-relationship-reversal test to
  `glitter-context-refresh-relationships.test.ts`.
- Regenerated `packages/glitter-context/src/generated-data.ts` (new safe bindings).
- Verified scoped: glitter-context (typecheck/test/lint), temporal
  (typecheck/test/lint), birmel (typecheck/lint), ruff, shellcheck, check:1password.

### Remaining

- F6 worker credential wiring — operator-blocked (1Password provisioning + snapshot
  refresh + redeploy), tracked in `todos/glitter-corpus-worker-credentials.md`.
- Review gate stays red until fix #1704 lands even at zero findings (known).

### Caveats

- `select-image-targets.ts` already routes glitter-context changes to consumer
  images via the workspace closure; only the two hardcoded site lanes needed the
  path addition — do not also touch the `images` lane.
- F6 code wiring was proven to fail `check:1password`; do not re-add it until the
  1P fields exist and the snapshot is refreshed.
