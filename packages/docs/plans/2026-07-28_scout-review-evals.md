---
id: scout-review-evals
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout Post-Match Review Evals

## Context

Scout generates a short, personality-driven reaction for selected post-match
reports. The goal is entertainment: reviews should be anchored to the match,
funny to the friend group, and recognizably written in the selected person's
style. Deliberate exaggeration, profanity, caricature, and occasional verbatim
phrases are acceptable when they improve the joke. The initial calibration
focuses on Aaron and NekoRyan because their style cards are especially distinct.

The existing browser review tool predates an explicit eval model. It is a broad
generation playground with one local 1-4 rating, IndexedDB persistence, and many
configuration controls. This work creates a dedicated local eval application
instead of adapting that UI.

## Approved Design

- Add a new `@scout-for-lol/evals` workspace under
  `packages/scout-for-lol/packages/evals`.
- Run locally on `127.0.0.1`; do not deploy or add authentication initially.
- Keep the interface deliberately minimal and task-focused. Prefer compact,
  neutral controls and efficient review flow over decorative presentation.
- Use Bun, TypeScript, Hono, tRPC, TanStack Query, React Router, Vite, SQLite,
  Zod, Tailwind v4, current shadcn `base-nova`, and Base UI.
- Reuse the platform-agnostic review pipeline from `@scout-for-lol/data`; do not
  import the production backend wholesale.
- Store structured local state in SQLite. Materialize selected S3 artifacts into
  SQLite so finalized datasets can be evaluated offline, while retaining source
  keys and content hashes for provenance.
- Source the corpus exclusively from Beta: raw match/timeline objects come from
  `scout-beta`, and tracked aliases/profiles come from a sanitized local snapshot
  of Beta SQLite. Do not accept caller-supplied or production profile mappings.
- Model datasets as mutable drafts that become immutable when finalized.
  Corrections create a new dataset version; model outputs and ratings remain
  separate records linked to immutable cases.
- Use stable URL routes for datasets, cases, freshness views, and judge runs.
  Preserve browser back/forward behavior, deep links, document titles, native
  forms, semantic HTML, and keyboard accessibility.

## Initial Dataset

Build one 20-case calibration dataset:

- Use explicit match-player pairs, not match-level cases.
- Split style assignments across Aaron and NekoRyan.
- Include multiple tracked friends.
- Use mostly refined exceptional performances, covering clearly great and
  terrible games, plus a few average controls.
- Begin with the existing exceptional-game classifier, enrich the displayed
  performance signals, and require human approval of the final case set.
- Freeze raw match, raw timeline, processed match, target player, deterministic
  facts, match summary, timeline summary, lane context, player history, patch
  context, style card, personality instructions, selected random behaviors,
  prompts, model settings, source refs, and hashes.
- Generate one baseline review per case. Repeated same-case generation is
  deferred until randomness itself needs investigation.

## Human Rubric

Rate each review on three independent 1-3 dimensions. Calculate the displayed
overall score as their simple mean; do not ask for another overall rating.

### Anchoredness

- `1` bad: no meaningful match connection, or fabrication replaces the game.
- `2` okay: uses basic correct details but could fit many similar games.
- `3` great: the joke grows from this match's distinctive story.

Creative distortion and invented events are acceptable when they make the joke
better and remain anchored to the game.

### Entertainment

- `1` bad: flat, awkward, confusing, or actively unfunny.
- `2` okay: readable and mildly amusing but unremarkable.
- `3` great: genuinely funny, memorable, quotable, or reaction-worthy.

### Style-Card Recognizability

- `1` bad: generic, contradictory, or resembles the wrong personality.
- `2` okay: uses some traits but feels like a shallow approximation.
- `3` great: distinctly recognizable, plausibly or as a funny caricature.

Profanity and harshness are not failures by themselves. Occasional verbatim
phrases are allowed.

### Freshness

After individual ratings, rate each style card's batch once:

- `1` bad: repeated openings, jokes, insults, examples, or structures feel
  formulaic.
- `2` okay: noticeable reuse, but enough variation remains.
- `3` great: recognizable voice with varied jokes, phrasing, intensity, and
  structure.

The human view does not highlight similarity before freshness is submitted.

## Rating Experience

- Show the generated review first, as a Discord reader would experience it.
- Use three required native radio groups and an optional note.
- Save with an explicit `Save and next` form action; do not autosave clicks.
- Put deterministic facts, generated match summary, timeline summary, style
  card, and exact prompt details in clearly labeled expandable context sections.
- Keep ratings editable through normal back navigation.
- Provide progress and resume behavior from the dataset overview.

## Judge Calibration

- Human labels are authoritative.
- Use most labeled cases to refine a structured AI-judge rubric and reserve
  several unseen cases for judge testing.
- Require the judge to emit the same three 1-3 scores with concise reasons.
- Compare agreement per dimension and inspect systematic bias, especially
  profanity penalties, literal-factuality bias, generic-polish preference, and
  Aaron/NekoRyan confusion.
- Do not establish automatic quality thresholds before measuring agreement.

## Production Findings

### Dead Timeline And Lane Context

The pipeline computes and passes `timelineSummary` and `laneContext` into prompt
variables, but the default final-review template references neither. Production
therefore pays for timeline summarization without letting that context affect
the review text. Preserve current behavior for the initial baseline, add prompt
fingerprint tests, then use the calibrated eval to compare a candidate that
inserts both inputs. Evaluate upstream summary quality separately later.

### Exceptional Reviewed-Player Mismatch

Production currently calls `isExceptionalGame` across every tracked player,
then independently prefers Jerred or randomly selects the reviewed player. A
different player can therefore qualify the match. Fix the flow so the reviewed
player is selected first and exceptional eligibility is evaluated only for that
player. Preserve the Jerred production override for testing, but do not apply it
to eval case classification.

## Implementation Phases

1. Create the workspace, local Bun/Hono server, Vite/React client, strict tooling,
   SQLite migration runner, and accessible routed shell.
2. Implement draft/finalized datasets, immutable materialized cases,
   generations, human ratings, freshness ratings, and exports.
3. Implement S3 candidate discovery, explicit match-player selection,
   performance slices, style assignment, context snapshotting, and baseline
   generation.
4. Implement case rating, progress, resume, context inspection, and freshness
   workflows.
5. Implement judge runs, holdout assignment, agreement reports, and disagreement
   inspection.
6. Fix reviewed-player eligibility while preserving the Jerred override.
7. Generate the current baseline, add timeline/lane prompt context as the first
   candidate, and review results before changing production defaults.

## Verification

- SQLite migration, transaction, finalized-dataset immutability, artifact hash,
  retry, and export/import tests.
- Candidate selection tests for multiple tracked players, performance slices,
  explicit targets, and the Jerred production override.
- Prompt fingerprint tests for model-visible inputs.
- tRPC boundary validation and Hono request tests.
- Component and browser tests for native radio groups, labels, Save and next,
  deep linking, document titles, refresh, back/forward navigation, responsive
  layout, and absence of credentials in the client bundle.
- Scoped build, typecheck, test, and lint for evals, Scout data, and Scout backend,
  followed by `bun run verify -- --affected`.
- Include rendered screenshots in the pull request for dataset selection, case
  rating, expanded context, and freshness views.

## Remaining

- [ ] Human-select and rate the initial 20-case dataset.
- [ ] Calibrate the AI judge and run the first prompt-context experiment.

## Session Log — 2026-07-28

### Done

- Agreed on the purpose, rubric, initial dataset, local application stack,
  persistence model, user workflow, and judge meta-evaluation approach.
- Identified the dead timeline/lane prompt inputs and reviewed-player eligibility
  defect in the current implementation.
- Added the loopback-only `@scout-for-lol/evals` workspace with Hono/tRPC,
  SQLite migrations and immutability triggers, React Router, TanStack Query,
  Tailwind, shadcn/Base UI components, and documented local commands.
- Implemented dataset/version storage, materialized cases, append-only
  generations, editable human ratings, freshness ratings, progress/resume, deep
  links, document titles, required native radio groups, explicit save-and-next,
  and expandable prompt/evidence context.
- Added explicit-spec SeaweedFS candidate discovery and text-only baseline
  materialization. Cases freeze exact raw objects and hashes, processed matches,
  summaries, prompts, style inputs, selected behaviors, model settings, and the
  initial generation before database writes.
- Moved the pure exceptional-performance classifier into
  `@scout-for-lol/data`, fixed production eligibility to classify the already
  selected reviewed player, and preserved the selected-Jerred override.
- Replaced production discovery with a Beta-only corpus contract: `sync-beta`
  reads the live Beta SQLite database into an ignored, sanitized local profile
  snapshot; discovery and materialization are fixed to tracked Beta profiles and
  the `scout-beta` bucket. The live sync loaded 42 profiles, and ranked solo/flex
  discovery succeeded against real Beta objects.
- Simplified the application to a compact neutral interface and verified desktop
  and real mobile layouts. On mobile, scoring now precedes optional case context
  and freshness review evidence. PinchTab submissions verified both save-and-next
  rating and save-freshness navigation end to end.
- Passed the final `bun run verify -- --affected` gate: 52/52 tasks, including
  evals' 21 tests, Scout builds/typechecks/lint/tests, docs checks, and gitleaks.
  `git diff --check` and a separate full-worktree gitleaks scan also passed.
- Added a deterministic Playwright suite that serves the production-built client
  against the real Hono/tRPC stack and an in-memory SQLite store. Six Chromium
  scenarios cover draft creation and validation, finalization, individual rating
  navigation and persistence, freshness and latest-generation selection, deep
  links and route ownership, missing records, and narrow mobile layouts.
- Fixed defects exposed by E2E: whitespace-only draft input no longer throws,
  cases cannot render under another dataset URL, missing queries terminate in a
  stable not-found state, empty styles cannot receive freshness ratings, notes
  enforce their schema limit, and case forms remount from persisted values when
  browser history changes the active generation.
- Integrated eval E2E into the existing Buildkite Playwright lane with matching
  PR/main selectors, filtered installation, Turbo environment passthrough, Knip
  ownership, and pipeline validation. `bunx turbo run test:e2e
--filter=@scout-for-lol/evals` passed 6/6 and the final affected repository
  gate passed 221/221 tasks.

### Remaining

- [ ] Human-select and rate the initial 20-case dataset after the application is
      available.
- [ ] Calibrate the AI judge and run the first prompt-context experiment.

### Caveats

- Generated art and upstream summary scoring are intentionally deferred.
- Quality thresholds must come from observed human/judge agreement rather than
  being selected in advance.
- The initial 20 cases are not frozen yet; Beta discovery now provides valid
  tracked match-player candidates, but the final balanced selection still needs
  human approval before model-backed materialization.
- The baseline intentionally preserves production's omission of timeline and
  lane context from the final-review template; those inputs are still frozen for
  the first controlled prompt experiment.
- Per the requested test scope, the new browser suite is fully hermetic and does
  not rerun credentialed Beta SQLite, S3, or OpenAI operations.
- Changes remain uncommitted in the `feature/scout-review-evals` worktree; no
  pull request was created because this session did not request one.
