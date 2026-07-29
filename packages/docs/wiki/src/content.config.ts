import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

import { wikiDocsLoader } from "./lib/wiki-loader.ts";

const docs = defineCollection({
  loader: wikiDocsLoader(),
  schema: docsSchema({
    extend: z.object({
      sourceKind: z.enum(["human", "working"]),
      sourcePath: z.string(),
    }),
  }),
});

export const collections = { docs };
