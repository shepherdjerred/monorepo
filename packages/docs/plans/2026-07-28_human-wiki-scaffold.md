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
- [ ] Merge and run post-deploy HTTP, cache-header, and CSP verification.

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
- Passed focused wiki unit tests, lint, typecheck, build, and Playwright
  coverage; liveness-checked every new GitHub link target.

### Remaining

- Await replacement Buildkite CI and hosted Codex review on the published
  public-data, link-routing, Astro-lint, and deployment-ordering fixes.
- After merge and deployment, run the live HTTP, cache-header, CSP, sitemap,
  robots, and public-corpus verification.

### Caveats

- The initial allowlist contains only the wiki scaffold plan. Each additional
  working document requires an explicit public-data review before its path is
  added.
- The first-deployment ordering is statically verified but cannot be exercised
  end to end until the main-only infrastructure and site lanes run after merge.
- Exact-head Buildkite build 7212 remained hard-red because LeetCode lint found
  a floating promise in `packages/leetcode/src/search.ts:218` and its search
  build could not start the embedding server. Trivy exit 7 was soft-failed.
