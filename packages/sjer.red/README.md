# sjer.red

Source code for my personal website at [sjer.red](https://sjer.red). An [Astro](https://astro.build/) site with Tailwind CSS, MDX content, RSS, and a sitemap.

## Commands

```bash
bun run dev          # local dev server (alias: start)
bun run build        # astro check + tsc + astro build
bun run preview      # preview the production build
bun run test:e2e     # Playwright visual-snapshot suite
bun run test:update  # rebuild, then update Playwright snapshots
bun run lint         # eslint (lint:fix to autofix)
bun run typecheck
bun run deploy       # bun ../../scripts/release/deploy-site.ts sjer-red
```

Deploys are a static sync to the object-storage host via the shared [`scripts/release/deploy-site.ts`](../../scripts/release/deploy-site.ts); credentials come from the environment (wrap with `op run`).

## Content

Content collections are defined in `src/content.config.ts`, with Zod schemas in `src/content/schemas/`:

- `blog` -- long-form posts (`src/content/blog/`)
- `til` -- "today I learned" entries (`src/content/til/`)
- `event` -- events (`src/content/events/`)
- `leetcode` -- LeetCode write-ups (`src/content/leetcode/`)

## Architecture notes

- **Visual regression** -- `test/index.spec.ts` screenshots key pages (home, links, blog list, individual posts and TILs) with Playwright's `toHaveScreenshot`. After an intentional visual change, run `bun run test:update` to refresh the committed snapshots.
- **OpenGraph images** -- generated at build time by the workspace [`astro-opengraph-images`](../astro-opengraph-images) package, configured in `astro.config.ts`.
- **Webring** -- `src/webring.ts` configures the workspace [`webring`](../webring) package with a list of RSS/Atom feeds; the site renders recent posts from those blogs.
