---
id: plan-2026-08-10-readme-refresh-removal-and-readme-overhaul
type: plan
status: complete
board: false
---

# Remove the README refresh workflow + repo-wide README overhaul

## Context

The `readme-refresh-weekly` Temporal schedule regenerates LLM-summarized project listings in three READMEs via embedded cog blocks, backed by ~106 committed `_summary.md` caches. The user wants it **entirely removed** — and, prompted by that, a **full audit/overhaul of every README in the repo**:

- Root README → high-level overview of the most important projects only
- `packages/README.md` (new) + `sandbox/{archive,practice,poc}` READMEs → directory-level overviews
- Package-level READMEs → the place for real **detail**; the audit found most are stale, several actively wrong

Three Explore audits verified every claim below against the live tree. Decisions made: **all 22 README-less packages get one**; the separate `astro-opengraph-images` README generator is **also removed** (hand-maintain); everything ships as **one PR** (git-spice, stack of one).

First implementation step: mirror this plan to `packages/docs/plans/2026-08-10_readme-refresh-removal-and-readme-overhaul.md` (repo rule for approved plan-mode plans).

---

## Phase 1 — Remove the Temporal README-refresh workflow

Delete:

- `packages/temporal/src/activities/readme-refresh.ts`, `src/workflows/readme-refresh.ts`, `src/activities/readme-refresh.test.ts` (its `parsePorcelainPaths` tests already duplicated in `scout-season-refresh-git.test.ts`)

Fix first: `llm-catalog-refresh.ts:6` imports `parsePorcelainPaths` from `./readme-refresh.ts` — repoint to the identical export in `scout-season-refresh-git.ts:78` (as `glitter-context-refresh.ts` already does); update stale comments at `llm-catalog-refresh.ts:27,75`.

Unwire:

- `activities/index.ts:16,46` — import + spread
- `workflows/index.ts:33-34,203-205` — imports + `runReadmeRefresh()` export
- `schedules/schedule-definitions.ts:197-208` — delete the schedule entry; fix the stagger comment at :213-214
- `schedules/register-schedules.ts:25` — **add `"readme-refresh-weekly"` to `DELETED_SCHEDULE_IDS`** (follow the `helm-types-weekly-refresh` precedent at :28-32; otherwise the live schedule keeps firing a missing workflow type)
- `schedules/register-schedules.test.ts:99` — remove `"runReadmeRefresh"`

CI harness (cog canaries):

- `scripts/rehearse-bot-clone.ts` — remove `COG_TARGETS` import (:58), `rehearseCogTargets()` (:412-431) + call site (:518), canary #4 header lines (:32-33, renumber), readme-refresh mention at :287
- `scripts/check-schedule-rehearsal.ts` — remove `COGAPP_VERSION` (:29-30), `ensureCogOnPath()` (:124-143), the uvx PATH-shim wiring (:149,160-164), header lines (:7,18-20)
- `scripts/smoke.ts` — remove the `cog` entry from `CLI_CHECKS` (:42) + comments (:18,27-28)
- `packages/temporal/turbo.json` — drop `src/activities/readme-refresh.ts` from `check:rehearsal` inputs; reword the cache:false comment citing uvx/cogapp

Dockerfile (`packages/temporal/Dockerfile`):

- Remove the renovate cogapp annotation + `ARG COGAPP_VERSION` (:117-118) and the `pip3 install cogapp` / `cog -v` lines in the block at :269-277 — **keep the `python3 python3-pip python3-venv` apt install** (the `uv` install at :280 needs pip3); retitle the block comment. Update header comments :8 and :13.

**Deploy note:** the live schedule is reconciled away on next worker deploy via `DELETED_SCHEDULE_IDS` — no manual Temporal UI action.

## Phase 2 — Remove the astro-opengraph-images README generator

Separate machinery from Phase 1, also going away (user decision — hand-maintain):

- Delete `packages/astro-opengraph-images/generate-readme.ts` and `README.md.tmpl`; keep the current `README.md` (audit: FRESH, 566 lines) as the hand-maintained baseline.
- Remove its wiring: package.json script, `scripts/ci-test-manifest.json:24-25`, root `turbo.json:134`, `scripts/script-migrations.json:196-207` (grep for exact keys at implementation).
- Keep `src/presets/render-examples.ts` — it renders the preset example images the README embeds; only the gomplate templating goes. (This moots the audit's finding that `generate-readme.ts` referenced a nonexistent `renderExamples.ts`.)

## Phase 3 — README architecture (overviews) + cog artifact removal

- **`README.md` (root)** — delete cog block (:7-253), generated listings (:254-389), and `## Updating READMEs` (:410-424). Rewrite as a short high-level page: what the monorepo is, a curated "highlights" list of the most important projects (~8-10: homelab, temporal, scout-for-lol, tasknotes family, toolkit, birmel, sjer.red, published npm packages), links to `packages/README.md` + sandbox READMEs + CLAUDE.md, and the existing `## Development` quickstart.
- **`packages/README.md` (new)** — overview: one line per package for all 46, grouped (apps/services, libraries, sites, infra, tooling). Descriptions sourced from CLAUDE.md's structure list + audit findings; factual one-liners, no dates, no LLM prose.
- **`sandbox/practice/README.md`** and **`sandbox/archive/README.md`** — strip cog blocks + listings; replace with a short intro + alphabetical bullet list, terse accurate one-liners (many existing generated summaries are hallucinated — write correct ones from directory contents, or bare links where nothing meaningful applies). Do not touch the projects themselves or their own (often vendored) READMEs.
- **`sandbox/poc/README.md` (new)** — 5-line overview of the poc projects.
- **Delete all 106 `_summary.md` files** (`fd -H _summary.md`) — nothing reads them after Phase 1.
- `.markdownlint-cli2.jsonc:41` — remove the `"**/_summary.md"` ignore; leave the sandbox ignores (sandbox stays lint-excluded by design).

## Phase 4 — Package-level READMEs: update 24, create 22

Style contract for all package READMEs: user/consumer-facing **detail** (what it is, how to run/build/deploy, architecture worth knowing); do **not** restate AGENTS.md — link it for contributor/agent process; every command copied from the live `package.json`; every URL liveness-checked.

### Updates (audit verdicts; fix the named findings)

| Package                       | Verdict     | Key fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| alert-dashboard               | STALE       | Deployment claim wrong (it IS deployed — digest pinned in homelab `versions.ts`, ArgoCD app exists); document full script matrix (`check:architecture`, `test:postgres`, `test:e2e`, migrations) + hexagonal layering                                                                                                                                                                                                                                                                                                                                                                      |
| anki                          | SKELETON    | Document decks, `mise run dev` → `scripts/generate-anki.ts`, settings.json/sql.js quirk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| astro-opengraph-images        | FRESH       | Add short maintainer section (tests, publish); now hand-maintained (Phase 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| better-skill-capped           | SKELETON    | Add run/build/deploy commands + manifest→parser→datastore architecture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| cooklang-for-obsidian         | STALE       | One canonical name; document 4 settings incl. nutrition; correct install path (releases go to `shepherdjerred/cooklang-for-obsidian`); chevrotain/CodeMirror stack                                                                                                                                                                                                                                                                                                                                                                                                                         |
| discord-plays-mario-kart      | STALE       | 4-path ROM resolution (sync with AGENTS.md), `discord-plays-core` split, complete e2e harness table, fix test command                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| discord-plays-pokemon         | STALE       | **Fix false "CI removed" claim** (Buildkite builds/smokes/pushes); benchmark harness; six skills not five; core split. Also: make `CLAUDE.md` a symlink to the byte-identical `AGENTS.md`                                                                                                                                                                                                                                                                                                                                                                                                  |
| discord-stream-lifecycle      | STALE       | Subsystem map (pool/session/discord/lifecycle/persistence), subpath-import contract from `src/index.ts:14-22`, build-before-test gotcha; keep diagrams                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| discord-video-stream          | FRESH       | Optional: clarify which media exports are fork-local                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| docs-board                    | FRESH       | Add short CLIs section (`check-docs`, `migrate-docs`, archive flow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| glitter-context               | FRESH       | Leave as-is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| home-assistant                | STALE       | Remove `bun add` claim (private pkg), fix/drop the unbacked GPL claim, delegate codegen detail to AGENTS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| homelab                       | STALE       | Fix pre-migration paths (`src/cdk8s`, `src/talos/...`); **fix false "CI removed" claim**; add `src/{cdk8s,talos,tofu,helm-types}` + `mac-ci` map; move Tracker-Tracker runbook out of the lead; stop duplicating AGENTS.md. Nested: `src/cdk8s/README.md` (skeleton → real overview), `src/tofu/README.md` (8 modules not 4, CI claim, dead `scripts/ci` ref), `mac-ci/README.md` (false removal banner, dead refs); `src/talos/README.md` is fresh — leave                                                                                                                                |
| leetcode                      | FRESH       | One line: Python lives inline in `embeddings.ts`; FTS5-only fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| macos-ai-subscription-tracker | FRESH       | Add "Brim = product name, QuotaBar = target/bundle id" note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| monarch                       | STALE       | Regenerate flag table from `src/lib/config.ts` (26 flags, 10 missing); add USAA/SCL/Apple/Costco sources + knowledge/enrichment/verification stages; link ARCHITECTURE.md                                                                                                                                                                                                                                                                                                                                                                                                                  |
| pr-fleet-controller           | FRESH       | Leave as-is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| scout-for-lol                 | STALE       | **Fix false "no CI" claim**; `mise run check`; full package list (app/desktop/evals/ui/docs-site); S3 + DuckDB report lake + ScoutQL + Temporal. Nested: `docs/README.md` (stale tree/stack), `packages/backend/README.md` (**Deno commands for a Bun package, references nonexistent files — rewrite**), `packages/desktop/README.md` (documents removed direct-to-Discord architecture — rewrite around `backend_client.rs`), `packages/report/README.md` (skeleton → cover renderers/snapshots), `scripts/README.md` (lint-staged → lefthook); `packages/evals/README.md` fresh — leave |
| sjer.red                      | SKELETON    | Commands, content collections, Playwright visual suite, OG pipeline, webring integration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| starlight-karma-bot           | STALE       | Ten subcommands not three (+recaps/milestones/rules); drop mise claim; **fix broken docker command** (context is monorepo root); document generate/migrate/smoke scripts; fix list numbering                                                                                                                                                                                                                                                                                                                                                                                               |
| tasknotes-fixtures            | FRESH       | Leave as-is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| trmnl-dashboard               | STALE-minor | Add `/api/diagnostics`, clients list, env reference, docker/smoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| webring                       | STALE       | **Published to npm — highest blast radius**: fix dead rawgit.com logo URL, docs link → `https://webring.sjer.red`, dead Astro example link → `packages/sjer.red/src/webring.ts`, document config surface                                                                                                                                                                                                                                                                                                                                                                                   |

### New READMEs (all 22)

Substantive (consumed/user-facing/no docs at all): **toolkit** (CLI usage + subcommands), **terraform-provider-asuswrt** (provider/resource docs — external consumers), **tasks-for-obsidian** (shipped app), **glitter** (public site, currently zero docs anywhere), **code-review** (shared lib, zero prose), **eslint-config** (consumed by every package), **llm-models**, **llm-observability**, **tasknotes-core** (Rust workspace conventions), **fonts** (what the patch script does + how to run), **stocks-sjer-red**, **streambot**, **birmel**, **tasknotes-macos**, **tasknotes-server**, **cooklang-rich-preview**, **temporal** (short index/entry point over the 38 KB AGENTS.md), **discord-plays-core**.

Minimal (3-8 lines, orientation + AGENTS.md link): **dotfiles**, **resume**, **release-tools**, **tasknotes-types**, **docs** (or point at existing `index.md`).

Cross-cutting while in there: add the missing `CLAUDE.md → AGENTS.md` symlinks in `discord-plays-core`, `stocks-sjer-red`, `streambot`, `tasknotes-macos` (matches the repo's 11-of-15 convention).

## Phase 5 — Temporal/docs cleanup

- `packages/temporal/AGENTS.md` — delete `## Weekly README refresh` (:319-328); remove `readme-refresh.ts` from the deterministic-PR list (:294); drop the cog-canary claim (~:305); historical mention at :302 may stay.
- `packages/docs/wiki/.../reference/temporal-workflows.md:23` — remove the readme-refresh row.
- `packages/docs/wiki/.../reference/temporal-schedules.md:59-61` — reword (only `scout-season-refresh` remains as the non-deterministic repo-artifact job).
- `packages/docs/plans/2026-07-31_wiki-temporal-workflow-deep-dives.md` — amend (active plan; would otherwise re-document the deleted workflow).
- Comment-only: `bot-clone.ts:55`, `scout-season-refresh.ts:368`, `agent-task-command.ts:108` (cog block reference).
- Archived docs: leave untouched.

## Verification

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal
bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal
bunx turbo run typecheck test lint --filter=@shepherdjerred/astro-opengraph-images
bunx prettier --check <all touched .md>
bunx markdownlint-cli2 README.md packages/**/README.md   # per repo globs
rg -n "readme-refresh|readmeRefresh|COG_TARGETS|cogapp|_summary|generate-readme|README.md.tmpl" --glob '!packages/docs/archive/**'   # expect zero live hits
# URL liveness (repo rule): batch curl -sI every link written/rewritten → expect 200
bunx lefthook run pre-commit
```

Optional heavier: `bunx turbo run smoke --filter=@shepherdjerred/temporal` (worker image build post-Dockerfile edit). Knip runs in CI's `bun run verify`.

Ship: one PR via the `git-spice-helper` skill (stack of one), title covering both the removal and the README overhaul; no screenshots needed (docs/infra only).
