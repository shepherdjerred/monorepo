# Better Skill Capped

[Skill Capped](https://www.skill-capped.com/) has some great content, but the website leaves much to be desired. It doesn't have search functionality, the video player is minimal, and figuring out what to watch next is more difficult than it should be.

Luckily Skill Capped provides a manifest of all their video data embeded right into the HTML they serve! This is a small React app that renders the video data in a nice interface.

![Screenshot of the website](assets/screenshot.png)

## Commands

```bash
cd packages/better-skill-capped
bun run start       # Vite dev server (--host)
bun run build       # production build to dist/
bun run test        # bun test
bun run lint        # eslint src
bun run typecheck   # tsc --noEmit
bun run deploy      # bun ../../scripts/deploy-site.ts better-skill-capped
```

`deploy` syncs `dist/` to the `better-skill-capped` SeaweedFS bucket serving
<https://better-skill-capped.com>. The deploy excludes `data/*`: a Temporal
workflow refreshes `data/manifest.json` daily, and the SPA fetches it at
runtime.

## Architecture

Data flows manifest → parser → UI, with localStorage-backed datastores:

- `src/manifest-loader.ts` fetches `/data/manifest.json`, validates it with a
  Zod schema (`src/parser/manifest.ts`), and caches it in localStorage via
  `LocalStorageManifestDatastore`, refetching when stale.
- `src/parser/parser.ts` transforms the raw manifest into the app's domain
  model (`src/model/`): videos, courses, and commentaries with display titles
  and URLs.
- `src/datastore/` holds datastore interfaces plus localStorage
  implementations for the manifest cache, bookmarks, and watch status, so
  user state persists across sessions without a backend.
- `src/components/` renders search (fuse.js), browsing, and the video views.

## Sponsors

A special thanks to [Sentry](https://sentry.io/) for sponsoring this project. Check them out!

[![Sentry Logo](https://i.imgur.com/6do6yJx.png)](https://sentry.io/)
