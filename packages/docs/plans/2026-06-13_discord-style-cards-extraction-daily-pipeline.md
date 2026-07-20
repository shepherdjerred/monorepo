---
id: plan-2026-06-13-discord-style-cards-extraction-daily-pipeline
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Plan: Extract `discord-style-cards` package + daily Temporal refresh pipeline

## Context

The `analysis/` tool buried in `packages/scout-for-lol/packages/analysis/` is **not**
scout/LoL-specific — it's a general **Discord chat-style profiler**. Two Python scripts read
Discord CSV exports and emit per-user "style cards" (`<name>_style.json`: voice, style markers,
sample messages, personality, `how_to_mimic`, etc.). Those cards are **actively consumed** today,
manually copied into three locations that drift out of sync:

| Location                                                      | Files | Consumer                                                                      |
| ------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| `scout-for-lol/packages/analysis/llm-out/`                    | 13    | source of truth (manual)                                                      |
| `scout-for-lol/packages/data/src/review/prompts/style-cards/` | 13    | scout **frontend** (static import) + **backend** (runtime disk load)          |
| `birmel/src/persona/style-cards/`                             | 10    | birmel persona engine (`style-transform.ts`, Zod) + `elections/candidates.ts` |

**Goal:** lift it to a top-level package `packages/discord-style-cards` that owns the canonical
cards, dedupe the three copies into it, port the generator to TypeScript, and add a **daily
Temporal pipeline** that fetches fresh Discord messages, keeps intermediate state on SeaweedFS, and
**incrementally iterates** each card with new data — opening a PR (data-dragon pattern) to update
the committed cards. Outcome: one source of truth, auto-refreshed, reviewable.

## Decisions (locked with user)

- **TypeScript port** — no Python in the Temporal worker image (it's Bun-only).
- **PR to one source-of-truth package** — `discord-style-cards` owns `cards/*.json`; scout + birmel
  import from it; daily workflow opens a PR updating them.
- **Name:** `packages/discord-style-cards`, npm `@shepherdjerred/discord-style-cards` (matches
  `@shepherdjerred/llm-observability` convention; CI change-detection maps scoped name → dir).
- **Cadence: daily, incremental-iterate.** Full-history backfill **once** per author (expensive,
  one-time); each subsequent daily run feeds the LLM `existing card + only new messages since last
run` → updated card. Cheap daily input; card moves only when new data warrants.
- **Consumed package stays lean** (only `zod`). Generation deps (`openai`, `discord.js`, tokenizer)
  live in `packages/temporal`, never in the shared package — so scout/birmel get no heavy transitive deps.
- **`file:` deps preserved** — scout uses `file:` not `workspace:` (do not change).

## De-risking strategy (staged rollout)

~90% of the risk is in Phase 2's automation (a daily job that writes to a package feeding production
personas, plus Discord/LLM/infra). Phase 1 is a behavior-preserving refactor. **Quarantine the risky
part instead of entangling it with the safe part:**

1. **Ship Phase 1 alone, first.** No behavior change: same cards, one source of truth. No
   Discord/LLM/cron/infra surface. Land → verify scout + birmel → bake. Move the `llm-out`
   source-of-truth cards **verbatim**; the scout/data + birmel copies (drifted) are reconciled to it
   deliberately — inventory card names per consumer before/after and assert **no consumer loses a card
   it had**. CI test `StyleCardSchema.parse()`-es every `cards/*.json` so malformed JSON can't land.
2. **No auto-merge.** The daily job _opens a PR a human approves_ — every card change is a reviewed,
   git-revertable diff; automation can't silently corrupt a persona. Auto-merge is a later opt-in once trusted.
3. **Manual one-time backfill.** Run the expensive full-history generation by hand, inspect, commit
   directly. The daily automation then only ever does the cheap **incremental** update.
4. **Port first, iterate second.** Land the pipeline with the straight full-corpus port (output
   comparable to known-good Python) to prove fetch→S3→generate→PR; add the novel incremental-iterate
   logic as a follow-up once the plumbing is trusted. Don't stack two new things.
5. **Containment (mostly already below):** dedicated read-only bot (birmel gateway untouched), schedule
   paused until configured, hard per-run budget guard (+ optional monthly ceiling/alert), `getS3Object`
   404-safe, and a **dry-run flag** (fetch+generate, skip PR) to eyeball output against one test channel.

**Sequence:** PR#1 refactor → PR#2 plumbing (manual trigger, dry-run, one test author, PR-only, straight
port) → manual backfill (reviewed) → enable daily incremental (still PR-only) → later, maybe auto-merge.

## Phase 0 — Worktree

```bash
git worktree add .claude/worktrees/discord-style-cards -b feature/discord-style-cards origin/main
cd .claude/worktrees/discord-style-cards
bun run scripts/setup.ts            # REQUIRED before any build/test in a fresh worktree
```

All edits below are relative to the worktree root. Commit + push after each phase.

---

## Phase 1 — Create package, move analysis, dedupe consumers

### 1a. New package `packages/discord-style-cards/`

```
packages/discord-style-cards/
├── package.json            # name @shepherdjerred/discord-style-cards; deps: zod only; copy llm-observability scripts/devDeps
├── tsconfig.json           # copy llm-observability/tsconfig.json + resolveJsonModule:true
├── eslint.config.ts        # copy llm-observability/eslint.config.ts
├── .gitignore              # data/  out/  __pycache__   (moved from analysis/.gitignore)
├── README.md
├── cards/<alias>_style.json    # 13 canonical cards, moved from analysis/llm-out
├── src/
│   ├── schema.ts           # single Zod StyleCardSchema (z.looseObject — passes edward/hirza `concerns` + future LLM keys) + type StyleCard
│   ├── cards.generated.ts  # static `import x from "../cards/x_style.json"` manifest + RAW_CARDS record (regen by workflow)
│   ├── roster.ts           # USER_ID_ALIASES, ALL_STYLE_CARD_NAMES, SCOUT_ALLOWED_PERSONALITIES, NAME_ALIASES, guild/channel config
│   └── index.ts            # getStyleCard(name) / listStyleCardNames() / styleCards record; re-export schema + roster
└── python/                 # ai_analyze.py, ai_analyze_llm.py — reference/local tooling only (NOT package deps)
```

- **Cards are bundled via static JSON `import`** (not disk reads) — required because scout frontend
  is an Astro/Vite static build that can't do `Bun.file()`. `index.ts` parses every card through
  `StyleCardSchema` once at module load.
- **Add a test** that `StyleCardSchema.parse()`-es every `cards/*.json` and asserts
  `cards.generated.ts` lists exactly the files on disk → a malformed/unlisted card from the daily PR
  fails CI before merge.

### 1b. Name reconciliation (do once, in `roster.ts`)

- Canonical card name = **`ryan`** (source-of-truth + birmel already use it). scout/data's file is
  `nekoryan_style.json`; map via `NAME_ALIASES = { nekoryan: "ryan" }`. Scout keeps the `nekoryan`
  _personality id_ (its `.txt`/`.json` persona files); only the _card lookup_ resolves through the alias.
- Canonical roster = superset of **13**. birmel will gain caitlyn/colin/richard in elections — desired
  default. (If birmel must stay at 10, export `BIRMEL_PERSONA_NAMES` and have `candidates.ts` use it.)

### 1c. Rewire consumers (delete the two copy dirs after)

| File                                                                                                       | Change                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout-for-lol/packages/data/package.json`                                                                 | add dep `"@shepherdjerred/discord-style-cards": "file:../../../discord-style-cards"`                                                                                                                                                      |
| `scout-for-lol/packages/data/src/index.ts`                                                                 | re-export `getStyleCard, listStyleCardNames, styleCards, StyleCardSchema, StyleCard, SCOUT_ALLOWED_PERSONALITIES, NAME_ALIASES` from the new pkg (keeps `@scout-for-lol/data/...` import surface; scout frontend/backend go through data) |
| `scout-for-lol/packages/frontend/src/lib/review-tool/prompts.ts`                                           | delete 13 static JSON imports → `import { getStyleCard } from "@scout-for-lol/data"`; `styleCard: JSON.stringify(getStyleCard("aaron") ?? {})`; `nekoryan` entry → `getStyleCard("ryan")`                                                 |
| `scout-for-lol/packages/backend/src/league/review/prompts.ts`                                              | drop `getStyleCardsDir()` path-walk + `Bun.file` loop; use `getStyleCard` + `SCOUT_ALLOWED_PERSONALITIES` + `NAME_ALIASES`; throw if card missing (preserves current behavior)                                                            |
| `birmel/package.json`                                                                                      | add dep `"@shepherdjerred/discord-style-cards": "file:../discord-style-cards"`                                                                                                                                                            |
| `birmel/src/persona/style-transform.ts`                                                                    | delete local Zod `StyleCardSchema`; `import { getStyleCard, StyleCard }`; `loadStyleCard` → `getStyleCard(persona) ?? null`                                                                                                               |
| `birmel/src/elections/candidates.ts`                                                                       | replace `readdir` with `listStyleCardNames()`                                                                                                                                                                                             |
| delete `scout-for-lol/packages/data/src/review/prompts/style-cards/` and `birmel/src/persona/style-cards/` | the two manual copies                                                                                                                                                                                                                     |
| delete `scout-for-lol/packages/analysis/`                                                                  | emptied after move (no package.json there)                                                                                                                                                                                                |

Run `bun install` in `packages/scout-for-lol` and `packages/birmel` to refresh lockfiles.

### 1d. Monorepo wiring (3 mandatory list edits — verified)

| File                        | Edit                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/src/catalog.ts` | add `"discord-style-cards"` to `ALL_PACKAGES` (alpha order). NOT in IMAGE_PUSH_TARGETS/DEPLOY_SITES/HELM_CHARTS (it's a lib)                  |
| `.dagger/src/deps.ts`       | add `"discord-style-cards": ["eslint-config"]` to `WORKSPACE_DEPS`; append `"discord-style-cards"` to `birmel` and `scout-for-lol` dep arrays |
| `knip.json`                 | add `workspaces["packages/discord-style-cards"] = { entry: ["src/index.ts"], project: ["src/**/*.ts"] }`                                      |

Then `bun run scripts/generate-deps.ts --check` to validate deps.ts. `scripts/setup.ts`,
quality-ratchet, check-suppressions, prettier/markdownlint auto-cover the new dir — no edits.

---

## Phase 2 — Daily Temporal pipeline + infra

Mirrors the **data-dragon** workflow (`packages/temporal/src/{workflows,activities}/data-dragon.ts`):
fetch → regenerate → clone → commit → `gh pr create` (PR-only; no auto-merge until trusted).

### 2a. New temporal files

```
packages/temporal/src/
  workflows/discord-style-cards.ts          # deterministic: fetch → generate → PR; re-export in workflows/index.ts
  activities/discord-style-cards.ts         # activities object; spread into activities/index.ts
  activities/discord-style-cards-fetch.ts   # discord.js login + incremental S3 corpus/watermark I/O
  activities/discord-style-cards-generate.ts# backfill-once / incremental-iterate OpenAI logic
  activities/discord-style-cards-tokens.ts  # gpt-tokenizer budget + truncate-corpus port
  activities/discord-style-cards-pr.ts      # clone+commit+gh PR (copy data-dragon)
  shared/s3.ts                              # ADD getS3Object() (current module is PUT-only)
  schedules/register-schedules.ts           # ADD discord-style-cards-daily ScheduleDefinition + config-pause
```

New temporal deps: `discord.js@^14`, `gpt-tokenizer@^2` (pure-JS, Bun-friendly; not WASM tiktoken),
`@shepherdjerred/discord-style-cards: file:../discord-style-cards`. `openai`/`zod`/`simple-git`
already present. Add `discord-style-cards` to the temporal-worker `depNames`/`depDirs` mount in
`.dagger/src/image.ts` (same mechanism as `toolkit`). **No Python in the image.**

### 2b. SeaweedFS intermediate state

- **Bucket** `discord-style-cards` in `packages/homelab/src/tofu/seaweedfs/buckets.tf` — **no
  lifecycle expiry** (corpus is slow/lossy to rebuild; treat like `scout-prod`).
- **Keys:**

  ```
  state/<guildId>/<channelId>/watermark.json   # { lastMessageId, lastTimestamp, updatedAt }
  corpus/<guildId>/<authorId>/messages.ndjson  # append-only raw ChannelMessage lines
  ```

- **`getS3Object`** added to `shared/s3.ts` (clone of `putS3Object` with GET method, empty payload
  hash, **returns `undefined` on 404** so first run doesn't crash). Reuses existing AWS4 signer — keeps
  `@aws-sdk/client-s3` out of temporal. Never return the corpus across an activity boundary (2 MiB cap).

### 2c. Activities

- **`fetchDiscordMessages`** (daily): read watermark → `channel.messages.fetch({limit:100, before})`
  paging back until it crosses `lastMessageId` (bound first-ever backfill with a hard page cap) →
  append new lines to per-author NDJSON in S3 → write new watermark → `destroyDiscordClient()` in
  `finally`. Returns counts + `touchedAuthorIds` only.
- **`generateStyleCards`** — the incremental-iterate core:
  - **Backfill mode** (no existing card / no generation watermark): full corpus → token budget
    (≤115k, oldest-trimmed) → one OpenAI call → full card. One-time expensive pass.
  - **Incremental mode** (existing card present): prompt = `existing card JSON + new messages since
card watermark` → "update this card with new signal, keep stable traits unchanged" → updated card.
    Cheap. Track per-card generation watermark (store `coverage.last_message_id` in the card).
  - Skip authors with `< minMessages` (50) on backfill / `< K` new messages on incremental.
  - **Budget guard** (port of `--budget`): throw before any call if projected cost exceeds `budgetUsd`.
  - `model: gpt-5.4`, **`temperature: 0.2`** (low, to minimize cosmetic churn), `response_format
json_object`, validate each result against `StyleCardSchema`, skip+log on parse failure.
  - Stage cards to temp S3 keys; pass keys (not bodies) to the PR activity.
- **`openStyleCardsPr`** — copy `updateDataDragon`: GitHub App token → clone `--depth 1` → write cards
  to `packages/discord-style-cards/cards/<alias>_style.json` + regen `cards.generated.ts` →
  `git status --porcelain` (skip PR if no diff) → **meaningful-change gate** (normalize arrays / drop
  volatile `coverage.notes` before diffing) → branch/commit/push `--force-with-lease` → `gh pr create
--fill` (**PR-only — no auto-merge; a human reviews every card diff. Auto-merge is a later opt-in**).
  10s heartbeats, `rm -rf` temp in `finally`. Support a **dry-run** flag that stops before the PR.

### 2d. Schedule (`register-schedules.ts`)

```
id: "discord-style-cards-daily", workflowType: "runDiscordStyleCardsUpdate",
cronExpression: "30 4 * * *",   // 04:30 PT (global SCHEDULE_TIMEZONE), low-traffic
taskQueue: DEFAULT, overlap: SKIP, workflowExecutionTimeout: "90 minutes"
```

Add `discordStyleCardsConfigured(env)` (false when `DISCORD_TOKEN` unset) to the config-pause set so
the worker starts cleanly before the token is provisioned.

### 2e. Secret wiring

- **Dedicated read-only Discord bot token** (NOT birmel's — one gateway connection per token; sharing
  would disconnect birmel). Add `DISCORD_TOKEN` field to the `temporal-worker-1p` OnePasswordItem and
  inject in `homelab/src/cdk8s/src/resources/temporal/worker.ts` via `EnvValue.fromSecretValue(...,
{optional:true})` (matches `VOYAGE_API_KEY` pattern). `OPENAI_API_KEY` + `AWS_*` + GitHub App creds
  already injected — no change.

---

## Config the user must provide before enabling

1. **Guild id** + **channel id(s)** to analyze → `discord-style-cards/src/roster.ts`.
2. **Dedicated bot token** → 1Password `temporal-worker-1p`. Bot invited to the guild with
   _View Channel_ + _Read Message History_, and **Message Content** + **Server Members** privileged
   intents toggled on (else `messages.fetch` returns empty `content`).
3. **Roster** `userId → alias` map (today only `Colin` is uncommented in the Python; real roster is
   the 13 card names). This gates which authors get a card and the `<alias>` filename.
   Until provided, the schedule stays paused — all code/structure can land first.

## Verification

- **Phase 1:** `cd packages/discord-style-cards && bun test && bunx tsc --noEmit`; then
  `bun run typecheck` + `bunx eslint .` in `scout-for-lol` (frontend+backend+data) and `birmel`;
  confirm scout review-tool and birmel persona still resolve cards. `bun run scripts/generate-deps.ts --check`.
- **Phase 2:** `cd packages/temporal && bun run typecheck && bun test` (incl. workflow-bundle smoke
  test). Dry-run an activity locally against a test channel with a real `DISCORD_TOKEN` + low `--budget`;
  verify watermark/corpus land in the `discord-style-cards` bucket and an incremental run only fetches
  new messages. Confirm `gh pr create` opens against `main` with only `cards/` changed.
- `cd packages/homelab && bun run typecheck` after worker.ts + buckets.tf edits; `tofu plan` for the bucket.

## Risks / notes

- **Privacy:** cards embed verbatim `sample_messages`/`quotes` and are committed to the repo — this is
  already true today (existing copies), but confirm repo visibility is acceptable; option to redact.
- **First-ever backfill** of a busy channel is many REST pages — bound with a hard page cap; incremental
  runs stay tiny.
- **Incremental drift:** low temperature + "only update with new signal" instruction + meaningful-change
  gate keep PRs signal-only. Card carries `coverage.last_message_id` as the generation watermark.
- **PR structure:** staged rollout (see **De-risking strategy** above) — PR#1 refactor → PR#2 plumbing
  (manual trigger, dry-run, PR-only, straight port) → manual backfill → enable daily incremental →
  later, maybe auto-merge. One worktree/branch, commit per phase.

## Open follow-ups (post-merge)

- Update `packages/scout-for-lol/AGENTS.md` (already stale — missing `app` + `analysis`) and root
  `CLAUDE.md` Structure block to add `discord-style-cards` and drop `analysis` from scout.

## Remaining

- [ ] Complete and verify the work described in `Plan: Extract discord-style-cards package + daily Temporal refresh pipeline`.
