import { z } from "zod";

export const BasePostSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  isDraft: z.boolean().default(false),
  starred: z.boolean().default(false),
});

export const BlogSchema = BasePostSchema.extend({
  image: z.string().optional(),
  hackerNews: z.string().url().optional(),
}).transform((val) => ({ ...val, description: val.description ?? val.title, type: "blog" }));

export const TilSchema = BasePostSchema.extend({
  title: z.string().transform((val) => `TIL: ${val}`),
  hackerNews: z.string().url().optional(),
}).transform((val) => ({ ...val, description: val.description ?? val.title, type: "til" }));

export const LeetCodeSchema = BasePostSchema.transform((val) => ({
  ...val,
  description: val.description ?? val.title,
  type: "leetcode",
}));
