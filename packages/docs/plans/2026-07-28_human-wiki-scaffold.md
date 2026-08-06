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
