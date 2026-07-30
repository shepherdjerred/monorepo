---
id: scout-league-classic-reports-2026-07-29
type: plan
status: in-progress
board: false
---

# Scout League Classic Reports

## Goal

Support League Classic queue 4310 end to end and replace Scout's prematch and
postmatch output for that mode with dedicated old-client-inspired reports.
Classic must remain a narrow, isolated report path: existing queues, schemas,
renderers, and enrichment behavior must not change.

## Dependencies and Delivery

- Base the work on the Data Dragon refresh in PR #1827, which supplies the Jade
  champions, spells, items, and generated snapshots.
- Deliver the implementation as a git-spice stack where a useful review
  boundary exists:
  1. Classic data contracts, assets, visual tokens, fonts, and style guide.
  2. Prematch/postmatch builders, renderers, backend routing, tests, and proof.
- Open draft PRs after the first coherent commits. Do not promote them to ready
  until focused checks, current-head Buildkite, and visual review artifacts are
  complete.

## Data and Classification

- Add `classic` as a queue type. Classify queue 4310 as Classic and resolve the
  exact `JADE` game mode before generic queue parsing, including custom games
  whose queue ID is zero. Keep queue 2450 and `KIWI_JADE` classified as ARAM
  Mayhem.
- Name map 453 `Classic Rift` and record Classic availability beginning
  2026-07-29 with no end date.
- Add narrow Classic loading-screen and completed-match schemas. Each team
  permits one through five players, while zero-player and six-player teams are
  rejected. Keep the existing five-player completed-match invariant by
  explicitly excluding Classic and Arena.
- Preserve stored Champion compatibility by making champion ID and Riot tag
  optional in generic records, then require them in new Classic records.
- Add explicit `classic` loading-layout and dedicated public Classic render
  functions; do not overload or change the output of existing renderers.

## Assets and Inference

- Extend the refresh/cache pipeline to fetch the CommunityDragon Jade loading
  background. Generated data must be reproducible rather than manually edited.
- Resolve 600xx champions and Jade spell IDs to their Jade assets. Use validated
  unique display-name mappings to modern champions/spells only for lane-order
  inference; never substitute modern art in Classic reports.
- Sort complete five-player teams by inferred top, jungle, mid, bottom, and
  support order without displaying role labels. Preserve Riot payload order for
  partial teams.

## Classic Prematch Report

- Resolve the queue and layout before enrichment. The Classic branch must make
  no rank calls.
- Render only champion art and name, Riot ID, two Classic summoner spells, team
  styling, and tracked-player markers. Do not render lanes, ranks, bans, runes,
  profile icons, or load percentages.
- Use a 1920x1280 canvas with five 320px cards per full team, 16px gaps, 128px
  horizontal margins, and vertically centered partial teams with no fake slots.
- Use the official Jade background full bleed with a dark overlay and compact,
  squared old-client framing.

## Classic Postmatch Report

- Resolve the queue before rank, timeline, history, or review enrichment.
  `processClassicMatch` must group the raw match by team ID without slicing and
  must make no rank, timeline, match-history, or LLM calls.
- Derive result perspective and hero splash from the first configured tracked
  player present. Mark every tracked row with the Classic gold treatment.
- Render result, map, duration, team totals, level, Classic portrait, full Riot
  ID, KDA, two spells, seven items, gold, and CS. Exclude ranks/LP, damage,
  vision, runes, AI review, rewards, chat, and social controls.
- Use a 1920px-wide canvas with height `520 + 68 * participantCount`, producing
  1200px for 5v5 and 860px for 3v2. Keep deterministic fixed-width table columns
  and safely truncate unusually long Riot IDs.
- Render Victory, Defeat, or Surrender from match fields rather than inferred
  score.

## Classic Visual System and Fonts

- Add a typed Classic-only token module and
  `packages/docs/guides/scout-classic-visual-style.md`. Label each style-guide
  claim as verified, measured, selected, or unknown and cite the reference
  images and research sources.
- Use QTFrizQuad Regular/Bold from TeX Live for display text and extracted Gill
  Sans Regular/Bold from the macOS TTC for body/table text. Bundle QTFrizQuad
  with its Qualitype license.
- Do not commit, publish, or bake Gill Sans into a public image. Store the two
  extracted files in a private versioned SeaweedFS bucket managed by OpenTofu
  with deletion protection, committed SHA-256 metadata, startup
  fetch/validation/cache, and local path overrides.
- Use the approved Classic type scale and palette in typed tokens, including the
  blue/red steel teams, muted navy panels, parchment text, and restrained gold
  tracked-player/result accents.
- Record the licensing boundary explicitly: the user authorized local/private
  use of their macOS Gill Sans copy; redistribution is intentionally excluded.

## Error Tracking

- Give unsupported prematch queues the stable fingerprint
  `prematch-unsupported-queue`, queue ID, game mode, and map ID. Keep game ID as
  event context rather than fingerprint material.
- Resolve the existing Bugsink issue only after a fresh production Classic
  prematch and postmatch both succeed.

## Verification

- Test 4310/JADE/custom classification, 2450/KIWI_JADE regression, map 453, and
  queue availability.
- Test 5v5, 3v2, and 1v1 schema acceptance plus empty, six-player, and malformed
  team rejection.
- Test all Jade champion/spell/item/background mappings and unique-name
  inference.
- Test builders with dependency spies proving Classic performs no rank,
  timeline, history, or LLM calls; cover team ordering, privacy placeholders,
  and multiple tracked players.
- Snapshot full and partial prematch reports and full/partial postmatch reports,
  including long Riot IDs, empty item slots, and all result states. Assert exact
  dimensions and deterministic SVG.
- Add a private-font Buildkite visual lane that verifies the exact font
  checksums before rendering.
- Run focused Turbo build, typecheck, test, and lint tasks for each affected
  package, then staged pre-commit checks and current-head Buildkite.
- Publish screenshots for full 5v5 prematch, partial custom prematch, and full
  postmatch in the PR.

## Deployment and Acceptance

- After merge, verify beta's deployed digest, ArgoCD health, backend logs, and a
  fresh Classic notification before promoting the existing minted Scout release
  through the production pin workflow.
- If Riot Match-V5 does not expose a live Classic match during validation, use a
  synthetic fixture for deterministic proof and create an awaiting-human TODO
  with a seven-day report-only follow-up. Do not claim live end-to-end
  acceptance without production evidence.

## Session Log — 2026-07-29

### Done

- Implemented queue 4310/JADE classification, Classic schemas, map and
  availability metadata, Jade asset mappings, and the generated official
  background.
- Added the isolated 1920px Classic prematch and postmatch builders/renderers,
  partial-team handling, exact-font visual fixtures, error fingerprinting, and
  regression coverage.
- Added the typed Classic style system and documented its measured, selected,
  verified, and unknown provenance.
- Created the private `scout-classic-fonts` bucket, uploaded the
  checksum-pinned Gill Sans files, and verified the OpenTofu adoption-only plan.
- Added a Buildkite visual lane that downloads, verifies, and renders with the
  private fonts without retaining SVG font outlines.
- Passed focused build, typecheck, test, and lint tasks for Scout data, report,
  and backend packages; verified the pipeline contract and OpenTofu formatting.
- Updated the AsusWRT provider's Go dependency closure to
  `golang.org/x/text` 0.39.0 after current-head Trivy identified
  CVE-2026-56852; module verification and the full provider test suite pass.
- Converted Classic postmatch champion asset keys to user-facing labels and
  added renderer-level coverage proving `Jade_` identifiers do not leak into
  visible report text.
- Corrected the completed Classic visual guide's canonical workflow status and
  validated the full docs model.
- Made private Classic font initialization retry after a rejected attempt while
  retaining one shared attempt for concurrent renders, with focused concurrency
  and retry tests.
- Matched the standard report path's known Riot participant-mismatch handling:
  Classic reports now skip metadata-only tracked players, retain present
  players, and return no report only when none remain.
- Made the frontend review tool reject unsupported League Classic matches
  explicitly while keeping queue selection exhaustive, with a schema-validated
  converter regression wired into the frontend test gate.
- Replaced the loading-screen builder's duplicate queue-ID layout catalog with
  exhaustive shared queue-to-layout classification, routing queue 2450
  `KIWI_JADE` on The Bandlewood through the ARAM report path while preserving
  existing ARAM and Classic layouts.
- Made the production-filtered Classic visual lane build the runtime artifacts
  exported by Glitter Context and LLM Models, and guarded both the package
  scripts and lane input/install closure in pipeline validation.
- Moved private Classic font validation into the fail-fast backend startup
  sequence before the health server, Discord login, or cron imports can serve
  traffic, with injected success and failure-ordering tests.
- Published draft PR #1849 on top of refresh PR #1827 with accepted full 5v5,
  partial 3v2, and postmatch screenshots.

### Remaining

- [ ] Drive current-head Buildkite and review feedback to green.
- [ ] After merge, verify OpenTofu adoption, beta deployment/notification, and
      the production promotion workflow before resolving the Bugsink issue.

### Caveats

- Gill Sans is authorized for local/private use only and must never be committed
  or included in a public container or artifact.
- Live Match-V5 acceptance depends on Riot exposing a Classic match during the
  validation window.
- Replacement current-head Buildkite and hosted-review results remain required
  after publishing the latest repair.
