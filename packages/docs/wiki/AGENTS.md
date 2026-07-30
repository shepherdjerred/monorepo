# Human wiki authoring

`packages/docs/wiki/` is Jerred's human-first explanation layer. AI agents
author it, but Jerred is the reader.

## Audience and voice

- Write directly for one technically sophisticated reader who owns this repo.
- Lead with what exists and why it matters. Omit generic teaching and filler.
- Be terse: one useful idea per paragraph and one topic per page.
- Prefer concrete names, paths, commands, and current system boundaries.
- Explain intent and tradeoffs, not a prose restatement of source files.
- This site is public. Never include secrets, private host details, tokens,
  personal data, or sensitive incident material.

## Visual-first explanations

- Use Mermaid when relationships, data flow, ownership, or lifecycle are easier
  to scan visually than in prose.
- Keep diagrams small enough to understand without zooming. Split dense diagrams.
- Every Mermaid block must include `accTitle` and `accDescr`.
- Use screenshots for real UI, dashboards, rendered output, and operational
  surfaces. Use a useful alt description and crop to the evidence.
- Store durable wiki images in `src/assets/`; use Astro image paths so the build
  optimizes them. Do not hotlink ephemeral screenshots.
- Do not add a diagram or screenshot when a sentence or short list is clearer.

## Page shape

Human pages live in `src/content/docs/`.

- Frontmatter must include `title` and `description`.
- Do not add a Markdown H1; Starlight renders the frontmatter title.
- Open with a one- or two-sentence answer.
- A good default sequence is: system map, key responsibilities, why it is this
  way, and where to look next.
- Use absolute wiki routes such as `/how-this-wiki-works/`.
- Link exact repository source when it helps verify a claim.
- Update an existing page instead of creating a near-duplicate.

## Human wiki vs. working material

- Curated explanations belong here.
- Plans, logs, TODOs, research notes, and agent handoff context remain in the
  parent `packages/docs/` taxonomy.
- Parent docs are private by default. The custom content loader renders only
  exact paths in `src/lib/wiki-publication.ts` under `/working/`.
- To publish a parent document, first review it for public-data safety, then add
  its `packages/docs/`-relative path to the explicit allowlist. Never copy an
  approved working document into the curated wiki.
- When implementation changes a meaningful boundary, workflow, or architectural
  reason, update the nearest curated page in the same change.

## Verification

From `packages/docs/wiki/`:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

For visual changes, inspect the built page at desktop and mobile widths and
include a rendered screenshot in the pull request.
