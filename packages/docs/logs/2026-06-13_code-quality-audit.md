# Monorepo Code-Quality Audit — 2026-06-13

## Status

Complete (audit only — no fixes applied). Findings below are candidates for follow-up work.

## TL;DR

The repo is **well-governed and structurally healthy**: every automated quality gate is green, the
suppression debt ledger is at baseline, and **first-party TypeScript typechecks with zero errors**.
Type-safety discipline (no `as`/`any`/`!`, Zod-at-boundaries) is genuinely strong and consistently
applied — the defects below are notable precisely because they are exceptions to an otherwise high bar.

The real risk is concentrated in **one subsystem and a few recurring habits**:

- **`birmel`'s editor/OAuth + Discord-moderation subsystem** is the single worst hot-spot — a dead
  permission module leaves privileged moderation unguarded, plus reflected XSS, OAuth CSRF, and a
  token-leak-on-error all live here. **Both Critical findings are in birmel.**
- **Swallowed errors / fail-soft where the house rule is fail-fast** — including one that causes
  **irreversible data loss** in scout (`.catch(() => null)` → `deleteMany`).
- **Missing network/subprocess timeouts** — the `AbortSignal.timeout()` pattern is known to the
  codebase but applied inconsistently (scout OAuth/audio, toolkit REST clients, tasks-for-obsidian).
- **Offline-sync correctness in tasks-for-obsidian** — a duplicate-task-create on the happy path,
  masked by tests that mock around the bug.

## Method

- Worktree: `.claude/worktrees/code-quality-audit` (branch `feature/code-quality-audit`), built from `origin/main`.
- Ran every standalone quality gate (see Gate Results) + full `typecheck` across all 33 packages + `knip`.
- Dispatched 8 parallel code-reading audit agents across balanced package clusters, each with a
  defect-focused rubric (type-safety holes, error handling, correctness, dead code, test quality,
  resource/security). Each agent was required to read and verify before reporting; several over-rated
  sub-findings were rejected during verification (e.g. scout `.loose()` schemas and a polling "race"
  that is actually atomic on the JS event loop).
- The headline Critical/High security findings were re-verified by hand (greps + direct reads).

## Findings by severity (counts)

| Cluster                                                                                                                                  | Critical | High | Medium | Low/Info |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ------ | -------- |
| birmel                                                                                                                                   | 2        | 3    | 1      | 1        |
| scout-for-lol (backend)                                                                                                                  | –        | 2    | 3      | 3        |
| scout-for-lol (app + desktop/Rust)                                                                                                       | –        | 2    | 1      | 3        |
| temporal                                                                                                                                 | –        | –    | 2      | –        |
| tasks-for-obsidian                                                                                                                       | –        | 2    | 3      | 1        |
| monarch                                                                                                                                  | –        | 2    | 2      | 2        |
| eslint-config                                                                                                                            | –        | 1    | 1      | 1        |
| better-skill-capped                                                                                                                      | –        | 2    | 1      | 1        |
| terraform-provider-asuswrt                                                                                                               | –        | 1    | 1      | –        |
| discord-plays-pokemon / mario-kart                                                                                                       | –        | 2    | 3      | 2        |
| streambot                                                                                                                                | –        | 1    | 1      | 1        |
| starlight-karma-bot                                                                                                                      | –        | 1    | 2      | –        |
| homelab                                                                                                                                  | –        | –    | 3      | 2        |
| toolkit                                                                                                                                  | –        | –    | 1      | –        |
| astro-opengraph-images / cooklang / leetcode / sjer.red / fonts / anki / llm-observability                                               | –        | –    | 2      | ~8       |
| **Healthy (no real defects):** home-assistant, tasknotes-types, trmnl-dashboard, stocks-sjer-red, webring, cooklang-rich-preview, resume |          |      |        |          |

---

## Critical

Both are in `packages/birmel`, both verified by direct read.

1. **Unguarded Discord moderation — `birmel/src/discord/permissions.ts` is dead code.**
   A complete permission-enforcement module (`validateToolPermission`, `canBanMembers`, `canKickMembers`,
   `canModerateMembers`, `canManageRoles`, …) exists but has **zero imports** anywhere in the package
   (verified: grep finds no call sites). The `moderate-member` tool
   (`src/agent-tools/tools/discord/moderation.ts:255`) goes straight from snowflake validation to
   `dispatchModerationAction(guild, ctx)` → `members.ban()` / `.kick()` / `.timeout()` with **no
   requester-permission check**. Authorization for ban/kick/timeout/role mutation therefore rests entirely
   on LLM prompt instructions — a prompt-injected or over-eager agent can moderate members. Both a
   security gap and dead code. **Fix:** fetch the requesting `GuildMember` (the `userId` is in
   `RequestContext`) and call `validateToolPermission(...)` in each privileged tool before executing.

2. **Reflected XSS — `birmel/src/editor/oauth-routes.ts:193-194`.**
   `renderErrorPage` interpolates the OAuth `error` / `error_description` query params straight into HTML
   (`<code>${error}</code>` and `<p>${description}</p>`), sourced from `c.req.query(...)`. A crafted
   callback URL injects arbitrary script into the page served by the bot's OAuth server. **Fix:**
   HTML-escape both values.

---

## High

**birmel**

- **`src/editor/github-pr.ts:64,112`** — push uses `authedUrl = https://${token}@github.com/...`; on non-zero
  exit `runGitCommand` throws `git ${args.join(" ")} failed: ${stderr}`, embedding the OAuth token in the
  thrown/logged error → credential leak to logs/Sentry. Redact the argv before throwing.
- **`src/editor/oauth-routes.ts:37,81`** — OAuth `state` is the raw Discord `userId`, trusted verbatim on
  callback to key `storeAuth(state, ...)`. No random nonce → CSRF / account-linking confusion. Bind a
  random nonce to the session.
- **`src/database/repositories/activity.ts:133`** — inside a Prisma `$queryRaw` tagged template, the date
  filter is built as a **nested JS template string**, so `AND createdAt >= ...` becomes a single _bound
  parameter value_, not SQL. The date range is silently ignored → wrong ranking whenever `dateRange` is
  supplied. (Correctness bug — Prisma parameterizes it, so it is **not** SQL injection.)

**scout-for-lol — backend**

- **`packages/backend/src/league/tasks/cleanup/validate-data.ts:214`** — `client.channels.fetch(id).catch(() => null)`
  collapses _every_ error (network, 5xx, rate-limit, `50001 Missing Access`) into `null`, then treats any
  falsy result as "channel gone" and feeds it to `cleanupOrphanedChannels` → `prisma.subscription.deleteMany`.
  **A transient Discord outage during this cron permanently deletes live channels' subscriptions.** Branch on
  the Discord error code (`10003 Unknown Channel` = truly gone) instead. _(Highest data-loss blast radius in the audit.)_
- **`packages/backend/src/storage/s3-leaderboard.ts:399`** — `loadHistoricalLeaderboardSnapshots` issues one
  `ListObjectsV2Command` with **no `ContinuationToken` loop and no `AbortSignal.timeout`**, so it silently
  truncates at S3's 1000-key page limit and can hang forever. The sibling `s3-query.ts:242` does both correctly.

**scout-for-lol — desktop (Rust)**

- **`desktop/src-tauri/src/backend_client.rs:205`** — `get_status` calls `self.config.blocking_lock()` on a
  `tokio::sync::Mutex`, but it is invoked from the async `#[tauri::command] get_backend_status` (`main.rs:157`),
  which runs on Tauri's Tokio runtime. `blocking_lock()` is documented to **panic inside a runtime context**.
  The UI polls this every 5s (`desktop/src/app.tsx:108`) → latent client crash. Make `get_status` async and
  use `.lock().await`.
- **`desktop/src-tauri/src/events.rs:214` (+ `main.rs:203-216`)** — `poll_live_game_data` / `run_event_loop`
  are spawned in detached `tokio::spawn` loops with **no cancellation**. `stop_monitoring` only flips the
  `is_monitoring` bool, which nothing in the loops reads → polling tasks run forever after "Stop" and
  **accumulate cumulatively** on each Stop→Start. Add a cancellation channel / `select!` on a shutdown signal.

**tasks-for-obsidian**

- **`src/state/TaskContext.tsx:177` (with `src/data/sync/MutationQueue.ts:173,233`)** — `createTask` enqueues a
  `"create"` mutation, calls `client.createTask()` directly, then calls `mutationQueue.replay(client)`, which
  re-executes the still-queued create. Create is not idempotent and the server ID from the direct call is
  discarded → **every normal online create produces a duplicate task on the server.** Tests never exercise
  enqueue+direct+replay together, so CI is blind to it.
- **`src/data/sync/SyncEngine.ts:97`** — optimistic replay of a queued `toggle_status` calls
  `getNextStatus(existing.status)` (derived from freshly-fetched server state) instead of the mutation's
  captured `payload.status`, so the optimistic view diverges from what the user queued. The unit test passes
  only by coincidence (`open`→`done` happens to equal the payload).

**monarch**

- **`src/lib/classifier/claude.ts:305`** — `computeSplits` divides each item by `itemSum` with no zero guard;
  all-zero LLM split items (schema allows `0`) give `0/0 = NaN`. The safety net at `verification/verify.ts:53`
  (`Math.abs(splitSum - txnAmount) > 0.02`) is `false` for `NaN`, so **`NaN` split amounts flow to the Monarch
  split-mutation API in a real-money pipeline.** Guard `itemSum > 0` and reject non-finite splits.
- **`src/lib/classifier/tier3.ts:184,~213`** — the agentic tier-3 loop runs up to 5 sequential
  `claude.messages.create()` calls with **no per-call timeout** (unlike the 30s GraphQL client); a malformed
  JSON response throws `SyntaxError`, which the `Anthropic.APIError`-only retry guard does not catch → the
  transaction is silently dropped instead of retried.

**eslint-config** _(thematic: the linter package commits the sins it bans)_

- **`src/rules/shared/tool-runner.ts:92`** — `const parsed = JSON.parse(output) as KnipOutput;` — banned `as`
  - unchecked `JSON.parse` of external `knip` subprocess output. If knip's JSON shape drifts, the loops at
    94/102 throw. Replace with a Zod `.parse()`.

**better-skill-capped**

- **`src/datastore/local-storage-watch-status-datastore.ts:7-13`** — `z.ZodType<WatchStatus>` validates
  `lastUpdate` as `z.unknown()` piped through `z.custom<WatchStatus>()` (no validator → always passes), but
  `WatchStatus.lastUpdate` is typed `Date` while it's a string after `JSON.parse`. A type-safety lie that
  mis-types any future `lastUpdate.getTime()` consumer.
- **`src/components/app.tsx:47`** — `void this.loadContent();` in `componentDidMount` has no `.catch`; a rejected
  manifest fetch/parse becomes an unhandled rejection (React ErrorBoundaries don't catch async lifecycle
  rejections) → silent empty state with no user feedback.

**terraform-provider-asuswrt**

- **`internal/client/nvram.go:67-72`** — `NvramSet` does `json.Unmarshal(body, &result)`, discards `result`,
  returns `nil`. The router's apply response is never inspected, so a **rejected/failed write reports success
  to Terraform** → silent config drift. Inspect the response status.

**starlight-karma-bot**

- **`src/index.ts:10-19`** — `Sentry.init(...)` is written above the side-effect imports
  (`import "./db/index.ts"` runs `dataSource.initialize()`, `"./discord/index.ts"` runs `client.login()`), but
  ES imports are hoisted and evaluated **before** the module body, so Sentry initializes _after_ the modules it
  is meant to instrument. **Startup errors — the most failure-prone phase — escape telemetry.** Move
  `Sentry.init` into a dedicated `instrument.ts` imported first, or make db/discord/server dynamic `import()`s.

**discord-plays-pokemon / mario-kart**

- **`.../config/schema.ts` (both packages)** — Discord-ID validator `z.string().regex(/\d*/, ...)` is useless:
  `*` = "zero or more" and the pattern is unanchored, so **any** string passes (`"abc"`, `"123abc"`). Only
  `.min(1)` does anything → garbage channel/server/app IDs reach the live Discord client. Use `/^\d+$/`.
  Duplicated across both packages.
- **`discord-plays-pokemon/.../discord/chord-executor.ts:12-14`** — the loop gates on `chord.delay > 0` but
  then waits `delay_between_actions_in_milliseconds` — two unrelated config knobs crossed, so `chord.delay`
  is never used as a duration and chord pacing is silently unconfigurable as intended.

**streambot**

- **`src/discord/command-handler.ts:300` (with `src/machine/queue-ops.ts:15`)** — `handleMove` never validates
  `from`/`to`; `moveItem` silently returns the queue unchanged on out-of-range indices, yet the handler
  unconditionally replies `Moved item X → Y`. User-facing silent failure (`handleRemove` range-checks; this
  doesn't).

---

## Medium

**temporal — non-determinism in workflow bodies** (breaks replay):

- `src/workflows/agent-task.ts:50` — `Date.now()` in workflow code; use `workflow.now()`.
- `src/workflows/homelab-audit.ts:58` — `new Date()` in workflow code (the field's doc comment even says it
  should default to the _workflow start time_, i.e. `workflowInfo().startTime`).

**birmel** — `src/editor/github-pr.ts:129` `applyChange` does `path.join(cwd, change.filePath)` with no
containment check before write → path traversal (`../../...`) on agent-produced paths. Add `resolve` + `startsWith(cwd)`.

**scout-for-lol — backend** — OAuth `fetch()`es with no timeout (`src/trpc/auth-web.ts:243,270`);
`data/src/data-dragon/champion.ts:118` `catch { return undefined }` swallows all errors with no log (champion
data silently vanishes from reports); `src/voice/audio-player.ts:81` `fetch(source.url)` streamed into a live
voice connection with no timeout.

**scout-for-lol — desktop** — `desktop/src-tauri/src/live_client.rs:6` `#![allow(dead_code)]` masks a large
block of genuinely dead, _duplicate_ code (`get_events`, `GameContext`, etc.) while `events.rs` re-implements
the same polling against raw `reqwest`/`serde_json::Value`.

**tasks-for-obsidian** — `MutationQueue.replay` (`:173`) is not re-entrant (overlapping triggers double-send
queued mutations — general form of the duplicate-create); `src/lib/dates.ts:5` `new Date("YYYY-MM-DD")` (UTC)
compared against locally-built midnights → tasks mis-grouped as overdue in negative-UTC timezones;
`src/screens/SettingsScreen.tsx:47` test-connection `fetch` has no timeout (the one screen most likely to hit a
bad URL).

**monarch** — `scripts/accuracy/label-server.ts:704` blind-casts an untrusted POST body
(`as GroundTruthLabel`) and writes it to `dataset.json`; `scripts/*` use banned `as` on file-read boundaries
where `src/` uses Zod; `src/lib/config.ts:81,89` CLI numeric args via `Number(...)` with no NaN/finite check.

**eslint-config** — `src/rules/prefer-date-fns.ts:343,347` `traverse(item as TSESTree.Node)` after only a weak
`"type" in item` check (banned `as` + lying cast); redundant `as` casts at 321/372 after a `.type ===` guard.

**better-skill-capped** — `src/parser/parser.ts:242` `Number.parseInt(commentary.gameTime)` where `gameTime` is
validated only as `z.string()` (the sibling `k`/`d`/`a` use `z.coerce.number()`) → latent `NaN`.

**terraform-provider-asuswrt** — `internal/provider/port_forward_resource.go:176` (and `dhcp_static_lease_resource.go:176`)
`Update` appends nothing if no matching entry exists (rule deleted out-of-band) yet `writeRules` succeeds →
reports a successful update that did nothing.

**astro-opengraph-images** — `src/util.ts:8-10` empty `catch { return false }` around `fs.access()` swallows
permission/I-O errors, not just "not found" → `getFilePath` can silently resolve wrong.

**cooklang-for-obsidian** — `src/cook-parser.ts:444-451` condition is `(A || B) && trimmed.endsWith(":")` where
the title-case heuristic `B` is unreachable because `&& endsWith(":")` already forces it; sub-headers not ending
in `:` are silently misclassified.

**tasknotes-server** — `src/middleware/auth.ts:27` (and `routes/health.ts:12`) `authHeader.replace("Bearer ", "")`
is a fragile, unanchored prefix strip; `src/vault/reader.ts` empty `catch`es make "permission denied"/"corrupt
YAML" indistinguishable from "no tasks".

**toolkit** — `src/lib/{grafana,bugsink,pagerduty}/client.ts` REST clients call `fetch()` with no
`AbortController`/timeout (the rest of toolkit consistently times out) → hung connection blocks the CLI
indefinitely.

**starlight-karma-bot** — `src/server/index.ts:10-38` unauthenticated `Bun.serve` static file server rooted at
`dataDir`, which also holds the SQLite karma DB (no auth, no resolved-path prefix check);
`src/karma/commands.ts:202` leaderboard tie-ranking relies on an unspecified row order (no outer `ORDER BY`).

**homelab** — `src/cdk8s/src/apps/` is dead (imported nowhere) and has _diverged_ from the live copies in
`resources/argo-applications/` (missing resource requests / `revisionHistoryLimit`); the SeaweedFS S3 endpoint
is hardcoded ~11× across `src/tofu`; `resources/mail/postal.ts:53`, `resources/mcp-gateway/index.ts:61`,
`resources/bugsink/index.ts:52` inline raw `itemPath` vault strings instead of the `vaultItemPath()` helper.

**discord-plays-pokemon / mario-kart** — `util.ts:17` `assertPathExists` uses `Bun.file(p).size === 0` for
existence (a zero-byte present file misreports as missing; should be `.exists()`) — both packages;
`discord/channel-handler.ts:10-31` voice-state `void (async()=>{})()` IIFE has no try/catch → unhandled
rejection — both packages; `message-handler.ts:23` logs failures at `logger.info` not `logger.error`.

**streambot** — `src/sources/subtitle-io.ts:170-206` embedded-subtitle ffmpeg extraction has no internal
timeout (unlike `probe.ts`'s `AbortSignal.timeout(15s)`); a hung ffmpeg wedges the `resolving` state.

---

## Low / informational

- **scout backend tests** — ~16 empty `test.skip(...)` blocks on the S3 _write_ path (false coverage of a
  critical persistence layer); several `expect(true).toBe(true)` tautological tests; `user.router.ts:139`
  `JSON.parse` without the Zod parse its siblings use.
- **scout desktop (Rust)** — vacuous unit tests asserting stdlib behavior (`42 == 42`, `PathBuf::join`);
  crate-wide `#![allow(dead_code)]` bundles a correctness signal with stylistic allows; `lcu.rs:123`
  `in_game` hardcoded `false`.
- **leetcode** — pervasive `as` casts on unchecked `JSON.parse`/SQLite rows + an empty `catch`; _but_ the
  package explicitly opts out of lint/tests (personal scraper) — low priority.
- **llm-observability** — one tautological smoke test (`expect(processor).toBeDefined()` on a just-constructed
  object). Otherwise clean.
- **sjer.red** — `event` content schema uses `z.date()` while blog/til use `z.coerce.date()` (string
  frontmatter would fail); `src/webring.ts:122` `_date` filter is a no-op stub.
- **better-skill-capped** — `app.tsx:88,131` `console.error(...)` + optional-chaining no-ops (logged-and-ignored).
- **tasknotes-server** — token compared with `!==` rather than `crypto.timingSafeEqual`.
- **monarch** — Apple/Venmo parsers default unparseable money to `0` (other parsers throw); Venmo CSV parser
  doesn't handle RFC-4180 escaped quotes.
- **fonts** — `patch-berkeley-mono.py` style-map break-on-first-substring mislabels `BoldOblique` as `Bold`;
  return-type hint lies (`-> Path` returns `None` on failure).
- **anki** — `generate.sh` has no `set -e`.
- **birmel** — `src/utils/errors.ts:26` `JSON.parse(text) as unknown` (allowed by the `as unknown` exception;
  callers must validate).
- **discord** — `message-handler.ts:81` logs the literal `undefined`; emulator `persist` is fire-and-forget
  (documented); `streamer.setVolume` clamps only the lower bound (machine clamps `[0,200]`; mitigated by the
  slash-command max).
- **Heavy duplication** across `discord-plays-pokemon` and `discord-plays-mario-kart` (`channel-handler.ts`,
  `util.ts`, `config/schema.ts`, `tracing.ts`, `game-streamer.ts` skeleton) — each shared defect lands twice;
  the two `game-streamer.ts` have _diverged_ (pokemon = XState orchestrator, mario-kart = older hand-rolled
  `opChain`/`settle()` that swallows op errors). Candidate for a shared `common/` module.

## Cross-cutting themes

1. **Missing timeouts on network/subprocess calls** — scout (OAuth, audio), toolkit (grafana/bugsink/pagerduty),
   tasks-for-obsidian (settings), streambot (subtitle ffmpeg). The `AbortSignal.timeout()` pattern is already in
   the codebase; it's applied inconsistently. _A repo-wide "every `fetch`/exec needs a timeout" lint/convention
   would close most of these._
2. **Fail-soft where the documented house rule is fail-fast** — `.catch(() => null)` (scout data-loss), empty
   catches (champion, astro util, tasknotes vault, leetcode). Contradicts the "never silently fall back"
   principle in the global instructions.
3. **Dead code that is also a missing control or a diverged copy** — birmel `permissions.ts` (security),
   homelab `src/apps/` (diverged config), scout `live_client.rs` (masked by `allow`).
4. **birmel's editor/OAuth + moderation is the security hot-spot** — XSS, CSRF, token leak, path traversal, and
   unguarded moderation all in one subsystem. Worth a focused security pass.
5. **Offline-sync correctness (tasks-for-obsidian)** — duplicate create, wrong toggle replay, non-reentrant
   queue — all masked by tests that mock around the bugs.
6. **eslint-config self-violations** — the package that defines `no-type-assertions` uses `as` + unchecked
   `JSON.parse` internally (tool-runner, prefer-date-fns, the config `as FlatConfig` casts).
7. **Validation regexes that don't validate** — the unanchored `/\d*/` Discord-ID check (both emulator
   packages) and the `replace("Bearer ", "")` token strip (tasknotes-server) both _look_ like guards but accept
   anything.

## What's healthy (don't "fix")

- **All automated gates green; suppression debt at baseline; 0 first-party TS errors.**
- **Type-safety is genuinely strong** — homelab, scout, toolkit, monarch, tasks-for-obsidian, home-assistant,
  and the emulator wasm/memory code (`bios.ts`, `renderer.ts`, `n64-emulator.ts`) all hit zero `as`/`any`/`!`
  and validate FFI/memory boundaries with `Reflect`/`instanceof`/bounds checks.
- **Zod-at-boundaries is the consistent norm** — the violations above are exceptions.
- **Essentially clean packages:** home-assistant (strongest — careful codegen + WS/REST clients),
  tasknotes-types, trmnl-dashboard, stocks-sjer-red, webring, cooklang-rich-preview, resume.
- Rejected-on-verification (NOT defects): scout `.loose()` Riot/Gemini schemas (correct for external APIs),
  scout polling "race" (atomic on the JS event loop), an alleged CSS-selector injection in astro-og
  (hardcoded constant).

## Gate / build results

| Check                         | Result                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quality-ratchet`             | ✅ pass (eslint-disable 9/9, ts-suppress 7/7, rust-allow 7/7, prettier-ignore 0/0)                                                                         |
| `check-todos`                 | ✅ pass (1 source marker, 12 docs)                                                                                                                         |
| `check-dagger-hygiene`        | ✅ pass                                                                                                                                                    |
| `check-react-version-sync`    | ✅ pass (37 lockfiles)                                                                                                                                     |
| `check-line-endings`          | ✅ pass                                                                                                                                                    |
| `guard-no-package-exclusions` | ✅ pass                                                                                                                                                    |
| `check-tunnel-dns-coverage`   | ✅ pass (31 TunnelBindings)                                                                                                                                |
| `check-1p-duplicates`         | informational (exit 0) — 46 reused values in the 1Password vault (vault hygiene, not repo code; e.g. one Okta password reused as a MacBook-login password) |
| `typecheck` (all 33 packages) | ✅ **0 first-party errors**                                                                                                                                |
| `knip`                        | exit 0; output dominated by config-coverage false positives (whole nested workspaces) + shared-config devDep noise — low signal                            |

> **Note on the `streambot` typecheck:** a from-scratch `typecheck` in a _fresh worktree_ surfaces ~49 strict-mode
> errors, but **all of them are in `packages/discord-video-stream/src/*`**, not first-party streambot code. This is
> an environment artifact: `scripts/setup.ts`'s "Refresh Built Dependencies" phase (which copies the
> `discord-video-stream` built `dist/` into the workspace `node_modules` copies) had not completed, so streambot's
> strict tsconfig type-checks `discord-video-stream` _source_ instead of its built `.d.ts`. Not a defect on `main`;
> CI builds the dvs image and never hits it. (`discord-video-stream` is an in-repo **rewrite**, not a fork.)

## Recommended fix order

1. **birmel security pass** (both Criticals + the 3 Highs): wire `permissions.ts` into the privileged tools,
   escape the XSS sink, redact the token in `github-pr` errors, add an OAuth nonce, fix the `$queryRaw` date
   filter, add the path-traversal guard. _Single highest-value PR._
2. **scout data-loss** (`validate-data.ts:214`): branch on Discord error code before `deleteMany`. _Irreversible._
3. **monarch `NaN` split** (`claude.ts:305`) — real-money correctness.
4. **tasks-for-obsidian duplicate-create** (`TaskContext.tsx`/`MutationQueue`) — corrupts user data on the happy path.
5. **scout desktop Rust** — `blocking_lock()` panic + leaked monitor tasks.
6. The recurring **timeout** + **fail-soft `catch`** themes — best handled as a convention/lint sweep rather than one-off.

---

## Session Log — 2026-06-13

### Done

- Set up worktree `.claude/worktrees/code-quality-audit` (branch `feature/code-quality-audit`) off `origin/main`.
- Ran all standalone quality gates (quality-ratchet, check-todos, check-dagger-hygiene, check-react-version-sync,
  check-line-endings, guard-no-package-exclusions, check-tunnel-dns-coverage, check-1p-duplicates) — all green.
- Ran full `typecheck` across all 33 packages — **0 first-party errors** (restored setup-churned generated helm
  types first; diagnosed the streambot/discord-video-stream errors as a setup-incompletion artifact).
- Ran `knip` (root + scout) — exit 0, low signal (documented why).
- Dispatched 8 parallel code-reading audit agents across all packages; verified the headline security findings by
  hand. Compiled this report (≈2 Critical, ~19 High, ~24 Medium, ~20 Low/informational).
- Corrected user-memory entries that mischaracterized `discord-video-stream` as a "fork" (it is a rewrite):
  renamed `reference_dvs_fork_vaapi_pipeline` → `reference_dvs_vaapi_pipeline`, fixed phrasing in
  `reference_dvs_dist_node_modules_stale`, updated the index.

### Remaining

- No fixes were applied — this is an audit. Recommended fix order is above; the birmel security pass is the
  natural first PR. Consider filing `packages/docs/todos/` entries for the Critical/High items if they won't be
  fixed immediately.

### Caveats

- Findings are point-in-time reads of `origin/main` @ `8f3538b1b`; re-verify file:line before fixing.
- Severity ratings are the auditor's judgment; the birmel "moderation unguarded" Critical assumes the bot is
  deployed where untrusted users can drive the agent — confirm the threat model before prioritizing.
- The full per-package **test suite was not executed** (many tests need live network/Discord/services and are
  known-flaky); test-quality findings come from reading the tests, and typecheck is clean. A scoped `bun test`
  run per package is a reasonable follow-up if pass/fail signal is wanted.
- `knip` and the raw `as`-grep census were treated as low-trust signals (both noisy here); findings lean on the
  agents' verified reads.
