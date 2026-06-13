# Error-Handling / Fail-Fast Audit — 2026-06-13

## Status

Complete (findings doc). Scope: first-party `packages/`, `scripts/`, `.dagger/`. Excludes `archive/`, `practice/`, `poc/`,
`packages/discord-video-stream/`, generated/target. Remediation tracked in `plans/2026-06-13_code-quality-remediation.md` (§9).

**Headline:** the codebase is, on the whole, **strongly fail-fast and well-instrumented**. Most candidate matches were
verified as legitimate defensive code (existence checks, Temporal-context guards, observable degraded defaults) and
excluded. Genuine violations cluster in a few file-I/O readers. Notably **absent**: any `|| fallback`/`?? fallback`
config-masking, and any unchecked-subprocess problem — both handled exemplarily.

## Genuine violations (fix these)

### High — silent data loss / lost telemetry

- **`tasknotes-server/src/vault/reader.ts:60-61`** — `readTaskFile` does `try { read + parse frontmatter } catch { return
undefined; }` with **no logging** → a single malformed/unreadable task `.md` silently vanishes from the index.
- **`tasknotes-server/src/vault/reader.ts:36-37`** — `scanVault` catches a `walkDir` failure and returns an **empty** Map
  with no log → a momentarily untraversable vault dir reports zero tasks instead of erroring. The whole reader has no telemetry.

### Medium

- **`webring/src/cache.ts:23-25`** — bare `catch { return {}; }` covers missing-file **and** corrupt JSON **and**
  `CacheSchema.parse` failure, no log → a drifted/corrupt cache silently degrades to "empty" forever.
- **`tasknotes-server/src/store/task-store.ts:52`** — inside the `watchVault` callback, `void this.init();` fires a re-scan
  with **no `.catch`**; `init()` → `scanVault` can reject → unhandled rejection, stale in-memory index. (This package wires no
  `unhandledRejection` net of its own.)

### Low

- `.dagger/src/release.ts:363` — `catch {}` inside an embedded `bun -e` one-liner (best-effort dep rewrite); add a comment.
- `scout-for-lol/packages/frontend/src/lib/review-tool/reset-defaults.ts:49` — `.catch(() => 0)` (review-tool UX).
- `leetcode/src/build-db.ts:146,231` — `JSON.parse(text) as Record<...>` (build-time script; throw aborts the build).
- Rust (scout desktop) — `main.rs:343` `Err(_) => Ok(None)` collapses a transient LCU error into "no local player";
  `lcu.rs:119`/`main.rs:331` `.ok()` for genuinely-optional values. Defensible; could log before collapsing.

## Verified clean (no findings)

- **`.catch(() => null)`** matches were almost all legitimate: `stat().catch(() => null)` existence probes (toolkit daemon),
  `.isVisible().catch(() => false)` Playwright probes (monarch scraper), `resp.text().catch(() => "")` error-body extraction.
- **`|| fallback` config-masking:** none — the repo uses `env-var` (throws on missing/mistyped) instead of `process.env || ""`.
- **Unchecked subprocess exit codes:** none — Bun `$` throws by default; the deliberate `.nothrow()` sites all inspect
  `exitCode` and return typed `{ ok, reason }` (`toolkit/lib/deployed/*`); `Bun.spawn` sites await/inspect `proc.exited`
  (`streambot/sources/probe.ts` even drains stdout+stderr to avoid pipe-buffer deadlock).
- **`safeParse` discipline:** every sampled call branches on `.success`. **`JSON.parse`** is overwhelmingly funneled into a
  Zod schema (throws on bad JSON / schema drift).
- **Go** (`terraform-provider-asuswrt`): clean — only `defer _ = resp.Body.Close()` discards (idiomatic); the one `//nolint`
  is a documented `insecure=true` opt-in.

## Systemic vs one-off

- **Systemic (lint candidate):** the _shape_ `try { read+parse } catch { return default }` recurs ~10+ times across
  monarch/streambot/scout/webring — but the **good** form logs first; only `tasknotes-server/vault/reader.ts` and
  `webring/cache.ts` omit the log. → custom rule **`catch-returning-default-must-log-or-throw`**: a `catch` returning a
  literal default must contain a `log.*`/`Sentry.*` call or a `throw`. Converts the offenders, passes the majority.
- **Systemic (off-the-shelf):** `void asyncFn()` without `.catch` — pervasive in `tasks-for-obsidian` (RN fire-and-forget,
  mostly fine) plus the one real `tasknotes-server` bug. Consider requiring `void p.catch(reportError)` in non-entrypoint files.
- **One-offs:** `.dagger/release.ts`, leetcode build-db, the Rust `.ok()` cases.

## What's done well (balance)

Zod-at-boundaries (175 files `Schema.parse`), exemplary subprocess handling, CI/Dagger hygiene codified+tested
(`check-dagger-hygiene.ts`), broad Sentry capture (52 files) with workflow/activity context in temporal, `AbortSignal`
timeouts (17 files), global `unhandledRejection`/`uncaughtException` nets in long-lived services
(`scout-for-lol/packages/backend/src/index.ts:86-113`), config via `env-var` (why `|| fallback` masking is absent).

**Net:** fix the two `tasknotes-server/vault/reader.ts` swallows (High) + `webring/cache.ts` (Medium) +
`task-store.ts:52` (`.catch`), then add the `catch-returning-default-must-log-or-throw` rule to make the prevalent good
pattern mandatory.
