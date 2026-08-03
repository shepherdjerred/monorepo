---
id: plan-human-wiki-scaffold
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Human-focused monorepo wiki scaffold

## Summary

Create `packages/docs/wiki/` as a public, human-focused Astro Starlight site at
`https://wiki.sjer.red`. Curated pages are deliberately terse and visual.
Existing AI-oriented documents remain available as lower-ranked working
material under `/working/`.

This phase delivers the complete site scaffold, content ingestion, authoring
instructions and skill, CI verification, and static hosting. It does not
attempt to author a comprehensive monorepo atlas.

## Implementation

- Add a private Astro 7 and Starlight workspace with static directory routes,
  responsive images, hover prefetching, externalized styles, local Pagefind
  search, a filtered sitemap, accessible Mermaid diagrams, and no SSR or
  client-side router.
- Define one typed content collection. Human Markdown uses clean routes and
  requires `title` and `description`; explicitly allowlisted `packages/docs`
  Markdown is rendered beneath `/working/`, hidden from the sidebar,
  down-ranked in search, and excluded from the sitemap.
- Add incremental loading, generated working-directory indexes, exact source
  edit links, title derivation for legacy pages, and link rewriting for docs,
  directories, repository files, and line references.
- Add only a homepage, a “How this wiki works” page, and a working-documents
  landing page as curated scaffold content.
- Update the root/docs/wiki agent hierarchy and create the repo-owned
  `monorepo-docs` skill in the chezmoi source and live target.
- Exclude the wiki subtree from docs-board workflow-frontmatter validation
  while retaining Markdown, schema, formatting, type, lint, test, and secret
  checks.
- Provision `wiki-sjer-red`, Cloudflare DNS, Caddy static hosting and CSP,
  lifecycle/cache policy, deploy catalog entries, Buildkite selectors,
  Playwright coverage, and live probes.

## Verification

- Unit-test loader caching, route and title derivation, directory indexes, link
  rewriting, missing targets, schema failures, and collisions.
- Build the complete current docs corpus and assert output coverage, canonical
  metadata, working-page robots policy, and sitemap filtering.
- Exercise desktop/mobile, light/dark, search ranking, Mermaid accessibility,
  edit links, 404 handling, and browser-console cleanliness with Playwright.
- Run package-scoped build, typecheck, test, lint, and e2e tasks; affected repo
  verification; homelab synth/tests; CI selector tests; deploy dry-run; and
  post-deploy HTTP/cache/CSP checks.
- Attach rendered desktop/mobile and search/diagram screenshots to the PR.

## Assumptions

- The entire site is public and unauthenticated. Working documents are included
  only through an explicit file-by-file allowlist; broad workflow-doc
  discovery is never a publication boundary.
- The initial title is “Jerred’s Monorepo Wiki” and Starlight’s restrained
  default visual language remains until real content motivates custom branding.
- `_astro/` is immutable; HTML, sitemap, robots, and Pagefind output remain
  `no-cache`.
- The implementation is one git-spice stack of one PR.

## Remaining

- [x] Finish implementation verification and publish the draft PR with visual
      evidence.
- [x] Merge PR #1784 and run post-deploy HTTP, sitemap, robots, and cache checks.
- [ ] Make the Caddy Deployment roll or reload when its security-header ConfigMap changes, then verify CSP and related headers externally.

## Session Log — 2026-07-28

### Done

- Scaffolded the Astro/Starlight wiki, curated entry pages, accessible Mermaid
  diagrams, responsive images, local Pagefind search, and the `/working/`
  projection of the existing AI-oriented docs corpus.
- Added human-first authoring instructions and the repo-owned `monorepo-docs`
  skill, then applied the skill to the live chezmoi target.
- Added docs-board isolation, unit and browser tests, static hosting, DNS,
  storage lifecycle, deploy-catalog, Buildkite, and post-deploy probe wiring.
- Fixed the clean-clone install rehearsal and LeetCode embedding subprocess
  shutdown defects exposed by whole-repo verification.
- Passed `bun run verify -- --affected` with 221 of 221 tasks successful,
  including the full 1,033-page wiki build.
- Committed the scaffold as `7a41e0c2f` and published draft
  [PR #1784](https://github.com/shepherdjerred/monorepo/pull/1784) with desktop,
  diagram, and mobile working-document screenshots.

### Remaining

- Merge [PR #1784](https://github.com/shepherdjerred/monorepo/pull/1784), allow
  the main-only deployment and infrastructure reconciliation to complete, then
  run the live HTTP, cache-header, CSP, sitemap, and robots verification.

### Caveats

- `wiki.sjer.red` is not expected to be live until the PR merges and the
  main-only deployment plus infrastructure reconciliation complete.
- Astro reports a non-blocking large-chunk warning for Mermaid, and Starlight
  reports its expected fallback-entry warning while generating `/404.html`;
  the built 404 page was verified directly.

## Session Log — 2026-07-29

### Done

- Replaced broad workflow-document publication with an explicit public
  allowlist in `packages/docs/wiki/src/lib/wiki-publication.ts`.
- Added focused coverage proving unapproved operational and infrastructure
  documents cannot enter the working-document collection.
- Updated the curated wiki copy to describe the allowlist boundary for
  [PR #1784](https://github.com/shepherdjerred/monorepo/pull/1784).
- Centralized the working-document publication policy so links to unapproved
  Markdown, non-Markdown files, and unpublished directories remain on GitHub
  instead of pointing at nonexistent public wiki routes.
- Enabled the shared Astro ESLint configuration and renamed the two Starlight
  component overrides to kebab-case filenames, leaving `.astro` syntax and
  correctness rules active.
- Made the aggregate Buildkite `sites` step wait for `tofu-apply`, guaranteeing
  the SeaweedFS static-site bucket exists before the wiki's first deployment
  sync.
- Added a pipeline-validator invariant for the provisioning dependency and
  passed the focused validator, lane-coverage tests, Buildkite-script lint,
  typecheck, and formatting checks.
- Fixed the LeetCode search command's floating embedding-process shutdown
  promise with explicit awaited, error-propagating lifecycle handling.
- Added focused lifecycle tests proving shutdown completion is awaited, failed
  exits propagate, and keyword-only searches remain a no-op; LeetCode test,
  lint, and local macOS build all pass.
- Replaced the LeetCode embedding client's `uv`-only availability check with a
  real server-readiness probe, ensuring failed startup processes are killed,
  reaped, and cleared before selecting the FTS5-only build path.
- Restored embedded Python stderr after model initialization failures and made
  shutdown cleanup unconditional while preserving startup, shutdown, and
  cleanup errors.
- Passed LeetCode unit tests, typecheck, lint, the complete 3,879-problem
  embedding build, and a forced startup-failure build that completed with all
  3,879 problems indexed in FTS5 and no fatal shutdown.
- Published the embedding-readiness fix as `a575507db`; exact-head Buildkite
  build 7235 passed the exhaustive Turbo verification lane.
- Made working-document publication fail when any allowlist entry is absent
  from the discovered Markdown corpus, reporting every stale path in a
  deterministic error.
- Added focused valid, configured-stale, and multi-stale allowlist tests; wiki
  unit tests, lint, typecheck, build, and Playwright coverage pass.
- Published the stale-allowlist validation as `81bfdc12d`; exact-head Buildkite
  build 7236 passed the exhaustive Turbo verification lane.
- Added `packages/docs/wiki/package.json` to all 14 frozen-install Docker
  contexts and narrowly exposed only that manifest through `.dockerignore`.
- Extended the image validator to derive explicit workspace manifests from the
  root workspace list and check every frozen-install stage, with focused
  coverage for derived paths, multi-stage success, missing manifests, and the
  Docker context exception.
- Passed the pipeline validator, focused image-validator tests, root-scripts
  typecheck and lint, and a representative BuildKit `prod-deps` target whose
  frozen filtered install completed successfully.
- Passed focused wiki unit tests, lint, typecheck, build, and Playwright
  coverage; liveness-checked every new GitHub link target.
- Diagnosed Buildkite build 7240's three Scout backend failures as stale test
  clocks that still treated the now-ended `2026_SEASON_2_ACT_2` fixture as
  future-ending.
- Added explicit active-filter instants to the competition query APIs and
  derived integration-test boundary times from the seeded season row, retaining
  strict exclusion at the season end while making future metadata corrections
  safe.
- Passed the two focused competition suites (28 tests), Scout backend typecheck
  and lint with zero errors, and the complete backend suite (1,213 passing,
  6 skipped, 0 failing).
- Documented the explicit file-by-file `/working/` publication allowlist in the
  parent docs instructions, wiki instructions, and `monorepo-docs` skill.
- Corrected the skill's root verification command to the existing
  `bun run check-todos` entrypoint and kept the live and chezmoi-source skill
  copies byte-identical.
- Removed the wiki config files from ESLint's global ignores, fixed the
  Playwright config issues this exposed, and verified the Bun-global restriction
  is active for both Astro and Playwright configuration.
- Passed wiki lint and typecheck, both skill schema checks, the live/source
  skill comparison, calculated ESLint config assertions, and the root
  1,011-document docs check.
- Removed the duplicate hook-free root installs from the Scout queue-windows
  and showcase refresh activities, leaving `installScoutWorkspace` as the
  single owner of root installation plus both required producer builds.
- Added focused bot-clone and activity-source invariants that prove one root
  install, both `llm-models` and `glitter-context` builds, and no caller-owned
  install in the two affected activities.
- Restacked the full PR onto `main` at `96f640057`, preserving current pipeline
  and Scout query APIs while carrying forward the wiki additions and
  deterministic season-boundary fixtures; regenerated the root lockfile and
  proved a frozen root install.
- Passed the focused regression tests, all 338 Temporal activity tests,
  Temporal typecheck, Prettier, Markdown lint, staged-file safety hooks, and
  `git diff --check`.

### Remaining

- Await replacement Buildkite CI and hosted Codex review after this review-fix
  cycle is published.
- After merge and deployment, run the live HTTP, cache-header, CSP, sitemap,
  robots, and public-corpus verification.

### Caveats

- The initial allowlist contains only the wiki scaffold plan. Each additional
  working document requires an explicit public-data review before its path is
  added.
- The first-deployment ordering is statically verified but cannot be exercised
  end to end until the main-only infrastructure and site lanes run after merge.
- The local stack is cleanly restacked on current `main`; GitHub will not
  reflect the rewritten ancestry until the stack is submitted.
- Production callers still default active filtering to the wall clock; the
  explicit instant is an opt-in seam for deterministic tests and replayable
  queries, not a fallback around season expiry.
- Buildkite 7246's `@shepherdjerred/glitter-context` dependency-closure failure
  is separate from these review findings; PR #1849 is independently diagnosing
  the same root and its evidence can be reused in the next CI cycle.
- Buildkite 7250's next authoritative failure is the Scout backend image smoke:
  Discord command registration refuses to start because the bundled season
  metadata has no active season. PR #1851 contains the related expiry-safe
  command intent and should be inspected in the next remediation cycle.
- The canonical Temporal lint task is not green after the restack: the newly
  enabled Unicorn rules report 1,079 errors across the package. Migrating that
  package-wide surface is intentionally not folded into this narrow
  duplicate-install review fix.

## Session Log — 2026-08-02

### Done

- Confirmed PR #1784 merged with green exact-head Buildkite #7255.
- Confirmed `wiki.sjer.red`, sitemap, and robots return HTTP 200 and the `s3-static-sites` application is `Synced`/`Healthy`.
- Inspected both the public response and in-pod origin response: required CSP and related security headers are absent even though the current ConfigMap contains them.

### Remaining

- Add a GitOps-managed Caddy reload or Deployment checksum rollout for ConfigMap changes, then repeat external security-header verification.

### Caveats

- The site is live, but this plan remains active because configured security policy is not actually served.
