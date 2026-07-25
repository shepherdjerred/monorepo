---
id: reference-completed-2026-06-19-pokemon-goal-fs-and-limits
type: reference
status: complete
board: false
---

# Plan: Goal bot — higher command limits + scoped memory/log filesystem

## Context

Two goal-bot improvements, both on the unmerged `feature/pokemon-goal-memory`
branch (worktree `.claude/worktrees/pokemon-goal-memory`), shipping together:

- **A. Higher pokemonctl command caps** for the bot (vs casual Discord chat
  users). Approved defaults: `max_quantity_per_action=60`, `chord_max_commands=32`,
  `chord_max_total=200`.
- **B. Reshape the memory surface** into a small, scoped (jailed-to-the-memory-dir,
  traversal-guarded) filesystem the bot drives with `LIST` / `READ` / `GREP` /
  `WRITE(MEMORY.md)`. This **replaces** the bespoke `memory show/write` +
  `session list/search/read/write` subcommands I shipped last session.

### Target PVC layout (per-guild, under `saves/<guildId>/goal-memory/`)

```
/
  MEMORY.md            # curated long-term memory, auto-injected into every prompt
  logs/
    2026-06-19T12-30-00-climb-the-stairs.md   # one per past goal session (system-written)
    2026-06-18T...-catch-a-zigzagoon.md
  archived-memory/
    2026-06-19T12-29-00.md   # the PREVIOUS MEMORY.md, snapshotted on each WRITE
    2026-06-18T...md         # older versions — still LIST/READ/GREP-able
```

Every `WRITE(MEMORY.md)` first snapshots the current `MEMORY.md` into
`archived-memory/<timestamp>.md` (system-written, read-only to the bot), so a
curated rewrite never loses prior content — the bot can `grep`/`read` old
versions to recover a lesson it trimmed. `GREP`/`LIST` cover the whole tree
(MEMORY.md + logs/ + archived-memory/).

### Tool model (confirmed with user)

| Tool               | pokemonctl                               | Scope                                  |
| ------------------ | ---------------------------------------- | -------------------------------------- |
| `LIST(path)`       | `pokemonctl list [path]`                 | whole tree, read                       |
| `READ(path)`       | `pokemonctl read <path>`                 | whole tree, read                       |
| `GREP(pattern)`    | `pokemonctl grep "<pattern>" [path]`     | whole tree, read                       |
| `WRITE(MEMORY.md)` | `pokemonctl write MEMORY.md "<content>"` | **MEMORY.md only**, must READ it first |

- All paths are relative to the memory root and resolved inside it (reject `..`,
  absolute paths, anything escaping root).
- `WRITE` rejects any path other than `MEMORY.md`.
- **Read-before-write**: `WRITE(MEMORY.md)` is rejected unless `READ(MEMORY.md)`
  happened earlier this session (per-session flag; single-writer per guild, so a
  flag — not CAS — is sufficient).
- **Archive-on-write**: each `WRITE(MEMORY.md)` first copies the current
  `MEMORY.md` to `archived-memory/<timestamp>.md` (skipped if absent/empty or
  content is unchanged), then overwrites. Archived versions are read-only to the
  bot but appear in `LIST`/`READ`/`GREP`.
- `/logs/*.md` and `/archived-memory/*.md` are **system-written**; the bot only
  reads them. The only bot-writable file is `MEMORY.md`.

---

## Part A — Higher command limits (approved 60/32/200)

| #   | Change                                                                                                                                                                     | File                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A1  | Add `command_limits` to `GoalConfigSchema` (60/32/200) — inner field schema **and** the outer `.default({})` literal (next to `memory_dir`)                                | `src/config/schema.ts`           |
| A2  | `isValid(chord)` → `isValid(chord, limits: ChordLimits)`; drop `getConfig` import; **fix bug** (per-command quantity checked vs `maxQuantityPerAction`, not `maxCommands`) | `src/discord/chord-validator.ts` |
| A3  | Discord path passes chat-user limits from `getConfig().game.commands` (numbers unchanged)                                                                                  | `src/discord/message-handler.ts` |
| A4  | Goal path: `chordResponse` passes goal limits; `pressResponse` caps on `game.goal.command_limits.max_quantity_per_action`                                                  | `src/goal/control-server.ts`     |
| A5  | Prompt: tell the agent its caps are high (generic "~32 cmds / ~60 repeats / ~200 total per chord")                                                                         | `src/goal/codex-command.ts`      |

`ChordLimits = { maxCommands; maxTotal; maxQuantityPerAction }`. Web/UI command
path (`src/index.ts`) enforces no limits today — pre-existing, out of scope.

---

## Part B — Scoped memory/log filesystem

### B1. `src/goal/goal-memory.ts` (rework)

- Rename `sessions/` → `logs/`; add `archived-memory/`.
- Keep `readMemory()`. `writeMemory(content)` now: snapshot current MEMORY.md to
  `archived-memory/<this.now()>.md` (skip if absent/empty/unchanged) → write new
  MEMORY.md → `pruneArchive(keep ≈ 50)`. Keeps existing empty/size caps.
- Add a private `resolveScoped(relPath)` — joins to memory root, `path.resolve`,
  verify result is inside root (reject `..` / absolute / escape). Reuse for
  list/read/grep.
- Add general primitives (replace `listSessionLogs`/`searchSessionLogs`/`readSessionLog`):
  - `list(relPath = ""): Entry[]` — `{ name, kind: "file"|"dir", path }`, dirs +
    files, newest-first within a dir.
  - `read(relPath): string` — scoped file read.
  - `grep(pattern, relPath = ""): Match[]` — `{ path, line, text }` across **all
    `*.md` under root** (MEMORY.md + logs/ + archived-memory/), case-insensitive,
    capped (~50 hits, ~200 files scanned).
- `writeSessionLog(meta, body)` stays but is now **system-invoked** with the final
  report as the body. Filename: `<startedAt-safe>-<goal-slug>.md` (sortable +
  readable). Frontmatter: goal, status, startedAt/finishedAt, exitCode, cost.
- Add `pruneLogs(keep = 200)` (after a log write) and `pruneArchive(keep = 50)`
  (after an archive snapshot) to bound PVC growth.
- Keep `buildSessionLogMeta(state)`.

### B2. `src/goal/goal-manager.ts`

- At each terminal path (`observeProcess`, `timeoutGoal`, `stopActive`) — right
  where `finalReport` is set + `recordCompletion` runs — also
  `await this.memory.writeSessionLog(buildSessionLogMeta(state), report)`.
  (Watch the 500-line lint cap; extract a tiny `finalizeCompletion` helper if needed.)
- MEMORY.md prompt injection already wired (`readMemory()` in `startGoalLocked`).

### B3. `src/goal/control-server.ts`

- Replace the `/memory` + `/sessions*` routes with:
  - `GET /list?path=` → `memory.list(path)`
  - `GET /read?path=` → `memory.read(path)`; if resolved path is MEMORY.md, set
    `context.fs.memoryRead = true`.
  - `GET /grep?q=&path=` → `memory.grep(q, path)`
  - `POST /write {path, content}` → require `path === "MEMORY.md"` and
    `context.fs.memoryRead`; else 409 with a clear message. Then `memory.writeMemory(content)`.
- Add a mutable per-session `fs: { memoryRead: boolean }` to the control context
  (server is recreated per session, so it resets naturally).
- Keep `/press`, `/chord`, `/progress`, `/status`, `/state`, `/history`.

### B4. `src/goal/pokemonctl.ts`

- Replace `memory`/`session` subcommands with `list`, `read`, `grep`, `write`
  (one quoted arg or stdin for write content). Update `usage()`.

### B5. `src/goal/codex-command.ts` (prompt)

- Rewrite the memory tool docs + END-OF-SESSION section:
  - Describe LIST/READ/GREP over `/` and WRITE to `MEMORY.md` (read-before-write).
  - "Your final answer is saved automatically as this session's log — make it a
    good record: what you did, what was hard/slow, what you learned."
  - "Before finishing: `read MEMORY.md`, then `write MEMORY.md` with an improved
    curated version (durable lessons only). `grep` past logs early when a goal
    resembles prior work."
- Keep MEMORY.md block auto-injected (already present).

---

## Files touched

Core: `goal-memory.ts`, `goal-manager.ts`, `control-server.ts`, `pokemonctl.ts`,
`codex-command.ts`, `config/schema.ts`, `chord-validator.ts`, `message-handler.ts`.
Tests/config: `goal-memory.test.ts`, `codex-command.test.ts`, `goal-manager.test.ts`,
`e2e-goal.integration.test.ts`, `schema.test.ts`, new `chord-validator.test.ts`,
`config.example.toml`.

## Risks / notes

- This **rewrites last session's still-unmerged memory tooling** (sessions→logs,
  bot-authored→system-authored logs, structured subcommands→fs primitives). Net
  simpler; nothing merged depends on the old surface.
- Bug fix in `isValid` is a no-op for default config (`max_commands ==
max_quantity_per_action == 10`); only matters if an operator set them apart.
- `schema.test.ts` exact-shape `toEqual` and the two typed `makeGoalConfig`
  literals must gain `command_limits` or tests fail to compile.
- `WRITE` is MEMORY.md-only by design; logs are immutable system records.

## Verification

1. `bun run typecheck` clean.
2. `goal-memory.test.ts`: scoped path resolution rejects `..`/absolute; `list`
   shows MEMORY.md + logs/ + archived-memory/ newest-first; `read` round-trips;
   `grep` finds matches across MEMORY.md + logs + archived-memory with file/line;
   `writeMemory` caps; **second `writeMemory` snapshots the prior content to
   `archived-memory/` (and the old text is grep-able), identical write does not
   archive**; `writeSessionLog` writes `logs/<name>.md`; `pruneLogs`/`pruneArchive`
   keep newest N.
3. `chord-validator.test.ts` (new, pure): caps + bug-fix regression guard
   (50-qty passes, 70-qty fails under `{32,200,60}`).
4. `schema.test.ts`: goal default shape includes `command_limits`; partial table
   fills defaults.
5. Update `makeGoalConfig` literals + `config.example.toml` (`[game.goal.command_limits]`).
6. `bun test src/goal src/config src/discord` + `bunx eslint` on changed files — green.
7. End-to-end smoke (reuse prior pattern): real `pokemonctl` against the control
   server — `list` shows `MEMORY.md` + `logs/`; `grep` finds a seeded line;
   `write MEMORY.md` is **rejected** before a `read MEMORY.md`, **accepted** after;
   a second `write MEMORY.md` leaves the prior version under `archived-memory/`
   that `grep` still finds; `write logs/x.md` rejected (not MEMORY.md); `..`
   traversal rejected; a goal that ends leaves a `logs/<name>.md`. Plus: `chord
"40_d"` accepted under goal limits, rejected under chat limits (10).

## Session Log — 2026-06-19

### Done

- **Part A (limits):** added `game.goal.command_limits` (60/32/200); made
  `isValid` pure (`ChordLimits`) + fixed the per-command-quantity bug (now bound
  to `maxQuantityPerAction`); Discord chat path passes `game.commands.*` (numbers
  unchanged), goal `chord`/`press` paths pass the higher goal caps; prompt notes
  the higher caps. New `chord-validator.test.ts`.
- **Part B (scoped fs):** reworked `goal-memory.ts` into `MEMORY.md` + `logs/` +
  `archived-memory/` with `list`/`read`/`grep`/`writeMemory`, scoped-path guard,
  archive-on-write (+ `pruneArchive`/`pruneLogs`), `isMemoryPath`. Logs are now
  **system-written** at session teardown (folded into `recordCompletion`).
  Control server routes replaced with `/list` `/read` `/grep` `/write`
  (read-before-write gate via per-session `fs.memoryRead`, MEMORY.md-only write).
  `pokemonctl` → `list/read/grep/write` (dispatch `Map`). Prompt END-OF-SESSION
  rewritten (read-before-write curation; final answer = the session log).
- Verify: typecheck clean, eslint clean, 123 tests pass; two throwaway smokes
  (real control-server fs routes + pokemonctl CLI mapping) both green.

### Caveats / deltas from plan

- **First-write deadlock fix (found via smoke):** a brand-new save has no
  `MEMORY.md`, so an explicit `read MEMORY.md` would 404 and the gate could never
  be satisfied. `readResponse` now reads MEMORY.md through `readMemory()` (returns
  empty, sets `memoryRead`) so the first curate works.
- This reshapes the prior session's (unmerged) `memory show/write` + `session *`
  tooling — net simpler; nothing merged depended on it.
- Same-millisecond MEMORY.md archives would collide on filename (benign — the bot
  writes MEMORY.md a couple times per 30-min session; real clock advances).
- Web/UI command path still enforces no input limits (pre-existing; out of scope).
