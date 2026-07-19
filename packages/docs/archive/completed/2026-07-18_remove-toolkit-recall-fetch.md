---
id: plan-2026-07-18-remove-toolkit-recall-fetch
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# Remove `toolkit recall` + `toolkit fetch` entirely

## Context

The recall local-RAG system (LanceDB + SQLite FTS + MLX embeddings + launchd watcher daemon) isn't good enough to keep. User wants it **entirely removed**, including `toolkit fetch` (its feeder), the 16 GB `~/.recall` data dir, and every AI-facing instruction that tells agents to use them. Replacement guidance for web access: encourage **lightpanda** (fast headless fetch), **PinchTab** (real-Chrome interactive), **Docling** (document extraction), "or similar" — the `lightpanda-browser` / `pinchtab-helper` skills and the existing Docling CLAUDE.md section remain the how-tos.

Exploration verified: recall/fetch are self-contained in toolkit (daemon is recall-only; discord has its own separate daemon); **no npm dep is fetch-only** (lightpanda/pinchtab are spawned external binaries); recall-only deps are `@lancedb/lancedb` + `gray-matter`. Only cross-package coupling: `packages/temporal` shells out to `toolkit recall search` (nullable, lexical-only path already tested).

## Work items

Worktree: `git worktree add .claude/worktrees/remove-recall -b feature/remove-recall origin/main` → one PR.

### 1. packages/toolkit — delete code

| Action      | Path                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| delete dir  | `src/lib/recall/`, `src/daemon/`, `src/lib/fetch/`, `src/commands/fetch/`, `test/recall/`, `skills/recall/` |
| delete file | `src/handlers/recall.ts`, `src/handlers/fetch.ts`                                                           |

Edits:

- `src/index.ts` — drop `case "recall"` (134-138), `case "fetch"` (129-133), usage lines 13-25, 96-99
- `package.json` — drop deps `@lancedb/lancedb`, `gray-matter`; `test:unit` glob: remove `test/recall test/fetch test/daemon` (latter two don't exist)
- `install.sh` — remove: `RECALL_DIR` (7), recall-skill copy (32-35), `~/.recall` mkdirs (37-39), MLX pip install (41-47), plist install/launchctl (50-60), recall/fetch usage echoes (76-78); fix stale daemon-mmap comment (16-18). Keep binary build/codesign + pr-health skill copy.
- `AGENTS.md` — drop recall/fetch lines 9-10, 35-36, 43-44, 51-52 (tree + examples)

### 2. packages/temporal — remove dead recall layer

- `src/lib/hybrid-retrieval.ts` — remove `runToolkitRecallSearch`, `RecallSearchFn`, the semantic-merge path; keep lexical/symbol retrieval (the `recallSearch: null` path becomes the only path)
- `src/lib/hybrid-retrieval.test.ts` — update accordingly
- `src/activities/pr-review/bootstrap.ts:13,395`, `bootstrap-enrich.ts:7,23,103-116,163`, `scripts/replay-pr-review.ts:62,244` — unwire `recallSearch`
- `bootstrap.test.ts:335,385,401` — drop `recallSearch: null` from deps
- `Dockerfile:234` — comment mentions `toolkit … recall`; drop `recall` from list

### 3. AI-instruction / docs surface (repo)

- root `AGENTS.md` — delete "Toolkit — Fetch & Recall" section (309-349); lines 43 & 305: `(fetch, recall, pr, pd, bugsink, grafana)` → `(pr, pd, bugsink, grafana)` (CLAUDE.md is a symlink — one edit)
- `packages/dotfiles/AGENTS.md` lines 10-11 — replace the two `toolkit recall`/`toolkit fetch` bullets with one web-access bullet encouraging lightpanda (github.com/lightpanda-io/browser) for page fetches, PinchTab (github.com/pinchtab/pinchtab) for interactive/blocked sites, Docling for PDFs/documents, or similar tools; keep pointing at the `lightpanda-browser`/`pinchtab-helper` skills
- delete `packages/dotfiles/Library/LaunchAgents/com.shepherdjerred.toolkit-recall.plist` (else `chezmoi apply` recreates the daemon)
- `.greptile/files.json:34` — drop "LanceDB for recall index" clause (hand-maintained)
- `packages/docs/architecture/2026-02-22_monorepo-structure.md:26` — `(fetch, recall, pr, pd, grafana)` → `(pr, pd, grafana)`
- Leave alone: all historical `packages/docs/{logs,plans,archive}`; false positives (mastra "semantic recall", lol "Empowered Recall", monarch precision/recall metric, cluster-key.ts IR comment)
- Mirror this plan → `packages/docs/plans/2026-07-18_remove-toolkit-recall-fetch.md`

### 4. Live machine teardown (after code changes, ordered)

1. `launchctl bootout gui/$(id -u)/com.shepherdjerred.toolkit-recall` (currently loaded, PID live)
2. `rm ~/Library/LaunchAgents/com.shepherdjerred.toolkit-recall.plist`
3. `rm -rf ~/.recall` — **16 GB**, user approved full wipe
4. `rm -rf ~/.agents/skills/recall/` (live skill; `~/.claude/skills` symlinks here)
5. Rebuild + reinstall binary from worktree: `packages/toolkit/install.sh` (replaces 179 MB `~/.local/bin/toolkit` with recall/fetch-free build)
6. `chezmoi apply` (or verify `chezmoi diff` clean) so live `~/AGENTS.md` picks up the dotfiles edit
7. Memory edits: `MEMORY.md:5` drop "searchable via toolkit recall search" clause; `feedback_frugal_local_compute.md:36` drop obsolete `toolkit recall watch` bullet

## Verification

- `bunx turbo run build typecheck test lint --filter=@shepherdjerred/toolkit --filter=@shepherdjerred/temporal` then `bun run verify -- --affected`
- `toolkit --help` → no recall/fetch; `toolkit pr --help`, `toolkit discord status` still work (surviving commands intact)
- `launchctl list | grep -i recall` → empty; `ls ~/.recall` → gone; skills list no longer offers `recall`
- `chezmoi diff` → no pending plist recreation
- `rg -i "toolkit (recall|fetch)"` over living docs (AGENTS/CLAUDE/skills/architecture) → only historical logs/plans remain
- PR via `pr-monitor`; no screenshots needed (non-visual)

## Session Log — 2026-07-18

### Done

- Deleted all recall + fetch code from `packages/toolkit` (lib/recall, daemon, lib/fetch, commands/fetch, handlers, tests, recall skill); dropped `@lancedb/lancedb` + `gray-matter`; stripped `install.sh` (MLX pip, ~/.recall dirs, plist install). Binary: 179 MB → 65 MB.
- `packages/temporal`: `hybrid-retrieval.ts` → lexical-only `symbol-retrieval.ts` (RRF + `RecallSearchFn` removed); unwired `recallSearch` from bootstrap, bootstrap-enrich, replay script, tests; Dockerfile comment updated.
- Docs/instructions: root AGENTS.md Fetch & Recall section deleted; `packages/dotfiles/AGENTS.md` now recommends lightpanda/PinchTab/Docling (URLs liveness-checked); deleted the LaunchAgent plist from dotfiles; updated `.greptile/files.json`, architecture doc, leetcode embeddings provenance comment, `.quality-baseline.json`.
- Live teardown: launchd daemon booted out, live plist removed, `~/.agents/skills/recall/` removed, recall-free binary installed via `install.sh`, live `~/AGENTS.md` updated (chezmoi source updated in this PR), memory files updated.
- Verification: toolkit+temporal build/typecheck/test/lint 9/9 green; `bun run verify -- --affected` green via pre-push. PR #1540.

### Remaining

- `rm -rf ~/.recall` (16 GB) — the agent's delete was permission-denied; operator runs it manually.
- Merge PR #1540; then `chezmoi apply` is a no-op for the plist (already removed live).

### Caveats

- Temporal's PR-review retrieval is now lexical-only; semantic recall coverage is gone by design.
- `packages/temporal/src/activities/fetcher.ts` (unrelated HA fetcher) keeps its baseline entry — only the deleted `daemon/watch.ts` entry was removed.
