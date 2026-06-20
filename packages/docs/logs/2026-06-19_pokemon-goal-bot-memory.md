# Pokémon goal bot — persistent memory + session logs

> **Partly superseded** by `plans/2026-06-19_pokemon-goal-fs-and-limits.md` (same
> branch): the `pokemonctl memory show/write` + `session list/search/read/write`
> surface described below was reshaped into a scoped `list`/`read`/`grep`/`write`
> filesystem, and per-session logs became system-written. The per-guild + curated
> MEMORY.md design here still holds.

## Status

Complete (implemented + committed on `feature/pokemon-goal-memory`; the tooling
was reshaped in a follow-up — see the note above)

## Goal

Give the Discord-Plays-Pokémon "goal bot" (the Codex agent behind `/goal`) a
memory so lessons survive across goal sessions:

1. **Per-session reflection logs** — at the end of a goal session the agent
   writes "what did I do / what was hard or slow / what did I learn", saved one
   file per session and browsable via list/search/read tools.
2. **A single `MEMORY.md`** fed into every goal prompt that the agent curates at
   the end of each session.

## Decisions (confirmed with the user)

| Question                          | Choice                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How the agent updates `MEMORY.md` | **Curated rewrite** — agent reads the in-context `MEMORY.md`, rewrites an improved compact version (not append). Session logs are the immutable backstop. |
| Memory scope                      | **Per-guild** — each save's memory lives under `saves/<guildId>/goal-memory/`, mirroring how game saves are already isolated.                             |
| Session-log fail-safe             | **Agent-only** — the agent writes logs via `pokemonctl`; the system does not auto-stub one.                                                               |

Per-guild came essentially free: `pokemon-driver.ts` already interpolates
`goalStatePath`/`goalScreenshotDir` from `session.sessionDir` (the guild key),
so a sibling `goal-memory/` dir persists on the same `saves/` ZFS PVC with zero
extra keying. No homelab/1Password/config change is required — the driver
overrides `memory_dir` at runtime exactly like `state_path`.

## Architecture

```
saves/<guildId>/goal-memory/
├── MEMORY.md            # curated, injected into every goal prompt
└── sessions/
    └── <startedAt>-<goalId8>.md   # one reflection per session (frontmatter + body)
```

- **`goal/goal-memory.ts` (new)** — `GoalMemory` class: file I/O only.
  `readMemory`/`writeMemory` (curated overwrite, empty + 16k-char caps),
  `writeSessionLog`/`listSessionLogs`/`searchSessionLogs`/`readSessionLog`
  (newest-first, path-traversal-guarded ids, 100-file search scan cap).
  Exports pure `buildSessionLogMeta(state)` that stamps a sortable, stable id
  from `startedAt` + goalId.
- **`GoalManager`** — constructs a `GoalMemory` from `config.memory_dir`
  (resolved relative to `runtime_directory`), exposes it as `readonly memory`,
  and reads `MEMORY.md` into the prompt context at goal start. (Kept lean — the
  delegations live in the control server to stay under the 500-line lint cap.)
- **`control-server.ts`** — new routes: `GET/POST /memory`,
  `GET /sessions`, `GET /sessions/search`, `GET /sessions/read`, `POST /sessions`.
  The write route stamps the active goal via `buildSessionLogMeta(getStatus())`.
- **`pokemonctl.ts`** — new subcommands: `memory show|write`,
  `session list|search|read|write`. Write commands take one quoted arg or stdin
  (heredoc) so multi-line markdown survives.
- **`codex-command.ts`** — `PromptContext.memory`; a `PERSISTENT MEMORY` block
  (with empty-state nudge via `formatMemoryForPrompt`), tool docs for the new
  subcommands, and an `END-OF-SESSION MEMORY` section instructing the agent to
  write a session log and curate `MEMORY.md` before its final answer.
- **`config/schema.ts`** — new `memory_dir` (default `goal-memory`).

## Files

- New: `packages/.../backend/src/goal/goal-memory.ts`, `goal-memory.test.ts`
- Changed: `goal/goal-manager.ts`, `goal/codex-command.ts`,
  `goal/control-server.ts`, `goal/pokemonctl.ts`, `lifecycle/pokemon-driver.ts`,
  `config/schema.ts`, plus `eslint.config.ts`, `config.example.toml`, and the
  `codex-command`/`goal-manager`/`schema` tests.

## Verification

- `bun run typecheck` — clean.
- `bun test src/goal src/config src/lifecycle` — 110 pass (was 87).
- `bunx eslint` on all changed files — clean.
- Throwaway end-to-end smoke: real `pokemonctl` CLI against an echo server —
  all 6 subcommands emit the correct method/path/body (incl. stdin piping for
  `session write` and URL-encoding for `session search`), matching the
  control-server route switch.

## Session Log — 2026-06-19

### Done

- Added per-guild persistent memory to the goal bot: curated `MEMORY.md`
  injected into every prompt + per-session reflection logs, written/browsed by
  the agent via new `pokemonctl memory` / `pokemonctl session` subcommands.
- New `GoalMemory` module (+ tests), `memory_dir` config, driver wiring under
  `saves/<guildId>/goal-memory/`, control-server routes, prompt instructions.
- typecheck + 110 tests + eslint all green; CLI↔route mapping smoke-tested.

### Remaining

- Committed locally on `feature/pokemon-goal-memory` (worktree
  `.claude/worktrees/pokemon-goal-memory`). Push + PR pending the user's
  go-ahead.
- No live Discord run yet — the real Codex loop writing/curating memory across
  two back-to-back `/goal` sessions has not been observed end-to-end in prod.

### Caveats

- The agent overwrites `MEMORY.md` (by design). Caps (16k chars) + reject-empty
  guard the obvious failure modes; the immutable session logs preserve history
  if the model ever over-trims.
- `homelab/.../pokemon.ts:229` still has a stale comment claiming
  `screenshot_dir`/`state_path` come from config.toml — actually the driver
  hardcodes them under `sessionDir`. Pre-existing; left untouched.
- Memory persists only on the `saves/` PVC. A guild that never persisted a save
  still works (dir is created on first write).
