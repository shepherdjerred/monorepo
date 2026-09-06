import { env } from "node:process";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Bryan Bucks documentation ships on the beta site only.
 *
 * The feature is gated by the `betting_enabled` flag and enabled for exactly
 * one guild, which runs the beta bot, so documenting it on the production site
 * would advertise something no prod reader can use.
 *
 * This is a **build-time exclusion**, not a redirect: excluded entries never
 * enter the collection, so no route is generated and the files are physically
 * absent from the prod `dist/`. Sitemap, Pagefind, and the internal link graph
 * all follow, because they are derived from built routes.
 *
 * Defaults to `prod` — i.e. excluded — so a local `bun run build`, `astro dev`,
 * or any future caller fails closed. Only `scripts/release/scout-site-release.ts` sets
 * the flavor, and it sets it for both builds.
 */
const isBeta = env.PUBLIC_SCOUT_SITE_FLAVOR === "beta";

/** Starlight's own default; reproduced so the pattern can be narrowed. */
const ALL_DOCS = "**/[^_]*.{md,mdx,mdoc}";

const docs = defineCollection({
  loader: glob({
    base: "./src/content/docs",
    pattern: isBeta
      ? ALL_DOCS
      : [ALL_DOCS, "!**/bryan-bucks*/**", "!**/bryan-bucks*"],
  }),
  schema: docsSchema(),
});

export const collections = { docs };
