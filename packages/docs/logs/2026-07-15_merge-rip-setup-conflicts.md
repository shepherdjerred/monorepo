# Merge conflicts between feature/rip-setup and main — conflict resolution

## Status

Complete

## Context

`feature/rip-setup` (the setup.ts removal / manual-setup docs branch, ~20 plan
commits ending `fd07f5145`) conflicted with `main`, which had since landed
`6dba01a90` (remove all CI). Four conflicts. Initially resolved as a merge of
the branch into `main` (`0747794b8`); at the user's request that commit was
rewound and the identical resolution was redone as a merge of `main` into
`feature/rip-setup` (`8fab04164`, byte-identical tree), so the fix lives on
the branch and it now merges cleanly into `main`.

## Resolution

Both sides edited the same doc paragraphs about setup/CI removal. In every
case the branch's text was a strict superset of main's — it already contained
main's CI-removal wording ("removed 2026-07 with the CI pipeline", "Git hooks
were removed 2026-07") plus the setup.ts-removal wording. All conflicts were
resolved by taking the branch side:

| File                                                             | Resolution                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/temporal/src/activities/bot-clone.ts`                  | branch side — doc comment now points at root AGENTS.md "Development Setup" instead of `scripts/setup.ts`                 |
| `packages/discord-plays-core/AGENTS.md`                          | branch side — per-dep `bun install` instructions replace the setup.ts reference; keeps main's Dagger-helper-removed note |
| `packages/dotfiles/dot_agents/skills/worktree-workflow/SKILL.md` | branch side (both hunks) — drops setup.ts as a fix path; keeps main's "no hooks / no CI" wording                         |
| `scripts/setup.ts` (modify/delete)                               | deleted — main's only change since the base was a one-line deletion from the CI-removal commit; nothing to preserve      |

## Verification

- No conflict markers remain in the three resolved files.
- `packages/temporal`: `bun run typecheck` green (required building
  `eslint-config` + `llm-models` producers and installing deps for
  `llm-observability` / `home-assistant` in the main checkout first), and
  `bunx eslint src/activities/bot-clone.ts` clean.
- Live chezmoi copy of the worktree-workflow SKILL.md
  (`~/.agents/skills/worktree-workflow/SKILL.md`) already matches the merged
  source — no dual-edit needed.
- Remaining `scripts/setup.ts` mentions in the tree are historical
  ("was removed 2026-07") or in docs/todos, not live instructions.
- The redone merge on the branch (`8fab04164`) has a tree byte-identical to
  the original resolution (`0747794b8`), verified via `rev-parse ^{tree}`.

Merge commit: `8fab04164` on `feature/rip-setup`. `main` rewound to
`6dba01a90` (= `origin/main`). Nothing pushed.

## Session Log — 2026-07-15

### Done

- Resolved all four merge conflicts between `feature/rip-setup` and `main`
  (three files taken from the branch via rerere-replayed resolutions,
  `scripts/setup.ts` deleted).
- Per user request, moved the fix onto the branch: rewound `main` to
  `6dba01a90` and committed the merge as `8fab04164` on `feature/rip-setup`
  (in worktree `.claude/worktrees/rip-setup`), tree byte-identical to the
  original resolution.
- Verified: no leftover markers, temporal typecheck + eslint green, chezmoi
  live copy in sync.

### Remaining

- Merge `feature/rip-setup` into `main` (now conflict-free) and push when
  ready; afterwards remove the `.claude/worktrees/rip-setup` worktree and
  delete the branch.

### Caveats

- `packages/docs/todos/setup-ts-refresh-phase-no-retry.md` still references
  `scripts/setup.ts`, which no longer exists — that todo is likely obsolete
  and worth resolving/deleting in a follow-up.
- The original merge-on-main commits (`0747794b8`, `b95bc7330`) were reset
  away before pushing; they remain reachable only via reflog.
- Untracked `.turbo/` directory sits in the main checkout (from the turbo
  de-risk work); left alone.
