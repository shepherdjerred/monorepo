import { z } from "zod";

const MarketingTrackingEnvSchema = z.object({
  PUBLIC_PINTEREST_TAG_ID: z.string().trim().min(1),
  PUBLIC_REDDIT_PIXEL_ID: z.string().trim().min(1),
});

export const DiscordCtaLocationSchema = z.enum([
  "navbar",
  "home_hero",
  "home_final_cta",
  "getting-started",
  "docs",
  "whatsnew",
]);

export type DiscordCtaLocation = z.infer<typeof DiscordCtaLocationSchema>;

const rawPinterestTagId: unknown = import.meta.env["PUBLIC_PINTEREST_TAG_ID"];
const rawRedditPixelId: unknown = import.meta.env["PUBLIC_REDDIT_PIXEL_ID"];

const marketingTrackingEnv = MarketingTrackingEnvSchema.parse({
  PUBLIC_PINTEREST_TAG_ID: rawPinterestTagId,
  PUBLIC_REDDIT_PIXEL_ID: rawRedditPixelId,
});

export const marketingTrackingConfig = {
  pinterestTagId: marketingTrackingEnv.PUBLIC_PINTEREST_TAG_ID,
  redditPixelId: marketingTrackingEnv.PUBLIC_REDDIT_PIXEL_ID,
};
