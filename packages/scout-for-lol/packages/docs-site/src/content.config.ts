import { env } from "node:process";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

/** Dares and duels remain visible only on the beta documentation site. */
const isBeta = env.PUBLIC_SCOUT_SITE_FLAVOR === "beta";

/** Starlight's own default; reproduced so the pattern can be narrowed. */
const ALL_DOCS = "**/[^_]*.{md,mdx,mdoc}";

const docs = defineCollection({
  loader: glob({
    base: "./src/content/docs",
    pattern: isBeta
      ? ALL_DOCS
      : [
          ALL_DOCS,
          "!**/dares*",
          "!**/author-a-dare*",
          // Duels remain a beta product while the local-observation rollout is
          // evaluated, so their how-to and reference ship on beta only.
          "!**/run-duel-event*",
          "!**/duels*",
        ],
  }),
  schema: docsSchema(),
});

export const collections = { docs };
