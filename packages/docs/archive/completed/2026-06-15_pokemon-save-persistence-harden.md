# Pokémon — in-game save persistence: verify + harden

## Status

Complete

## Context

A session asked whether full-RAM "memory dump" persistence was worth adding
to `discord-plays-pokemon` (so a process restart resumes mid-play instead of
dropping back to the most recent in-game SAVE). Research confirmed there is
**no upstream save-state API** in `tripplyons/pokeemerald-wasm` or our
`ottohg/pokeemerald-wasm` fork (pinned at `ee8b964` via
`packages/discord-plays-pokemon/scripts/build-wasm.sh:32`). The only wasm
exports are `AgbMain`, `WasmRunFrame`, `memory`, and a handful of immutable
address constants — so the only path would be dumping the full
`memory.buffer` (~256 MiB) ourselves.

We dropped that in favor of relying on the existing in-game battery save
(`save_path` → `pokeemerald.flash`), verifying it's wired end-to-end, and
adding minimal hardening.

## End-to-end wiring — verification

All checked against `main` @ `d0d0a2ec5`. Every link works:

| Link                            | Where                                                                                              | Status                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Config schema accepts save_path | `packages/backend/src/config/schema.ts:129`                                                        | ✅ `z.string().min(1).optional()`                                     |
| Threaded into Emulator          | `packages/backend/src/index.ts:68`                                                                 | ✅ `savePath: config.game.save_path`                                  |
| Load before game init           | `packages/backend/src/emulator/emulator.ts:120` (then `agbMain()` at `:122`)                       | ✅ flash bytes blitted into wasm before BIOS/main runs                |
| Periodic flush                  | `emulator.ts:270-271` (default every 60 frames ≈ 1 s)                                              | ✅ hash-and-skip — only writes when flash changed                     |
| Shutdown flush                  | `emulator.ts:189` in `stop()` (`force=true`)                                                       | ✅ flushes regardless of hash                                         |
| GBA flash address correct       | `emulator/constants.ts:1-3, 20-21` (1:1 GBA addr space → wasm linear memory, FLASH @ `0x0E000000`) | ✅ matches pokeemerald-wasm's renderer; boot log confirms 256 MiB     |
| On-disk format correct          | `packages/backend/src/game/events/saves.test.ts:119-160`                                           | ✅ parses real Emerald `.sav`s (`after_starter / midgame / champion`) |
| PVC mounted in prod             | `packages/homelab/src/cdk8s/src/resources/pokemon.ts:54, 174-180`                                  | ✅ `ZfsNvmeVolume` 8 GiB at `${APP_ROOT}/saves`                       |
| Pod fs perms                    | `pokemon.ts:40-42` (`fsGroup: 1000`) + `:148-149` (uid/gid 1000)                                   | ✅ runtime user can write the PVC                                     |
| Prod `config.toml` sets it      | `packages/docs/logs/2026-06-06_pokemon-crashloop-stale-image-logger.md:32`                         | ✅ log explicitly confirms 1P config has `game.save_path`             |
| Path resolves into PVC          | `save_path = "saves/pokeemerald.flash"` (CWD-relative) + CWD = `APP_ROOT`                          | ✅ resolves to `/workspace/.../saves/pokeemerald.flash` → PVC         |

## Concrete changes

Three edits, all in `packages/discord-plays-pokemon/packages/backend/`:

1. **Atomic write in `persist()`** — `src/emulator/emulator.ts`. Write to
   `${path}.tmp`, then `fs.promises.rename(tmp, path)` (POSIX atomic). A
   SIGKILL or OOM mid-write at worst leaves a `.tmp` next to the real save;
   the real save is never torn. Belt-and-braces — the Gen-3 format's two
   redundant slots + sector checksums (`saves.test.ts:24-43`) would
   probably have survived a torn write, but we don't need to rely on that.
2. **Counter for invalid loads** — `src/observability/metrics.ts` adds
   `flash_save_load_invalid_total` (next to `snapshot_invalid_total`).
   Incremented in `emulator.ts`'s wrong-size branch (`loadSave`). Makes
   silent format-mismatch fallback visible on Grafana.
3. **Codex goal-loop prompt** — `src/goal/codex-command.ts`. Added an
   Operational guidance line: save in-game regularly via START → SAVE → YES
   after milestones (badge, new species, level milestone, important item)
   and every ~30 in-game minutes of progress. Saving from the overworld,
   not inside menus / battles / cutscenes.

No homelab / cdk8s / 1Password / config-schema changes.

## Verification

- `bun test src/game/events/saves.test.ts` — 3 pass.
- `bun test` (full backend) — 152 pass.
- `bunx tsc --noEmit` — clean.
- `bunx eslint <touched files> --fix` — clean.
- Post-deploy (not yet performed): observe `flash_save_load_invalid_total`
  on Grafana (should stay at 0), and `kubectl exec` to check the PVC for
  `pokeemerald.flash` mtime updates whenever Codex hits SAVE.

<!-- temporal-agent-task
{
  "title": "Verify discord-plays-pokemon flash-save hardening post-deploy",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-06-20T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/archive/completed/2026-06-15_pokemon-save-persistence-harden.md"
  },
  "prompt": "Verify the discord-plays-pokemon flash-save hardening (PR #1249) is healthy in production. Check two things and email findings with evidence/links:\n1. Query Prometheus / Grafana for the `flash_save_load_invalid_total` counter — it should stay at 0. Any non-zero value means a boot hit a corrupt or truncated `pokeemerald.flash` and silently fell back.\n2. Use `kubectl exec` against the discord-plays-pokemon pod to `stat` the flash file at `${APP_ROOT}/saves/pokeemerald.flash` and confirm the mtime is updating (i.e., Codex is actually issuing in-game SAVE during goal runs). Compare against the pod start time — if mtime is close to pod start after several hours of uptime, the Codex prompt change is not taking effect and we should consider plan-option-(b) (flash_save_stale_seconds metric)."
}
-->

## Session Log — 2026-06-15

### Done

- Verified the existing flash-save persistence path is wired correctly
  end-to-end (config → emulator → flush → PVC mount → prod 1P config).
- Researched upstream pokeemerald-wasm — no save-state API exists; full
  memory-dump approach abandoned.
- Made the three hardening changes above in worktree
  `.claude/worktrees/pokemon-save-harden` on branch
  `feature/pokemon-save-harden`.
- Mirrored harness plan from `~/.claude/plans/` to this file.

### Remaining

- Commit + open PR (awaiting user confirmation per typical workflow).
- After PR merges and image deploys: watch
  `flash_save_load_invalid_total` for any boots that hit a
  corrupt/truncated `.flash`, and visually confirm Codex now triggers
  in-game SAVE during long goal runs.

### Caveats

- Codex prompt change is behavioral — there's no programmatic way to
  enforce "the bot must save in-game"; we're trusting the model to follow
  the operational guidance. If post-deploy observation shows it ignoring
  the instruction, fall back to plan-option-(b) from the earlier draft
  (emit a `flash_save_stale_seconds` metric when the flash hash hasn't
  changed in N minutes and surface it on Grafana).
- The atomic-write `${path}.tmp` doesn't include a per-process suffix.
  Concurrent `persist()` calls (gated by the per-frame hash check at
  `emulator.ts:323-333`) are extremely unlikely to race, but if they did,
  the worst case is one rename failing with ENOENT (logged as
  `failed to persist flash save`) while the other rename succeeds. The
  on-disk file is always either fully-old or fully-new — never torn.
