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
  requires `title` and `description`; existing `packages/docs` Markdown is
  rendered beneath `/working/`, hidden from the sidebar, down-ranked in search,
  and excluded from the sitemap.
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

- The entire site, including legacy working documents, is public and
  unauthenticated.
- The initial title is “Jerred’s Monorepo Wiki” and Starlight’s restrained
  default visual language remains until real content motivates custom branding.
- `_astro/` is immutable; HTML, sitemap, robots, and Pagefind output remain
  `no-cache`.
- The implementation is one git-spice stack of one PR.

## Remaining

- [ ] Finish implementation verification and publish the draft PR with visual
      evidence.
- [ ] Merge and run post-deploy HTTP, cache-header, and CSP verification.

## Session Log — 2026-07-28

### Done

- Researched Astro, Starlight, Sätteri, Pagefind, Mermaid, responsive images,
  SEO, CSP, and the repository’s existing site delivery path.
- Validated the selected framework stack in a temporary Bun-built prototype.
- Recorded the approved implementation design in this plan.

### Remaining

- Publish the draft PR with visual evidence.
- Merge the PR, deploy from `main`, and run live HTTP, cache-header, and CSP
  verification.

### Caveats

- The main checkout contains unrelated untracked session logs; preserve them.
- The existing docs-site direction log predates the final public-site decision
  and will be superseded by this plan in the implementation worktree.
