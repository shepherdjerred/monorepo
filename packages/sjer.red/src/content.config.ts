import { defineCollection } from "astro:content";
import { BlogSchema, LeetCodeSchema, TilSchema } from "src/content/schemas";
import { EventSchema } from "src/content/schemas/event";
import { glob } from "astro/loaders";

const blogCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/blog" }),
  schema: BlogSchema,
});

const tilCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/til" }),
  schema: TilSchema,
});

const eventCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/events" }),
  schema: EventSchema,
});

const leetcodeCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/leetcode" }),
  schema: LeetCodeSchema,
});

export const collections = {
  blog: blogCollection,
  til: tilCollection,
  event: eventCollection,
  leetcode: leetcodeCollection,
};
