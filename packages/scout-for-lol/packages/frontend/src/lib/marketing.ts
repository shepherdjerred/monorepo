import { z } from "zod";
import {
  PUBLIC_PINTEREST_TAG_ID,
  PUBLIC_REDDIT_PIXEL_ID,
} from "astro:env/client";

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

const marketingTrackingEnv = MarketingTrackingEnvSchema.parse({
  PUBLIC_PINTEREST_TAG_ID,
  PUBLIC_REDDIT_PIXEL_ID,
});

export const marketingTrackingConfig = {
  pinterestTagId: marketingTrackingEnv.PUBLIC_PINTEREST_TAG_ID,
  redditPixelId: marketingTrackingEnv.PUBLIC_REDDIT_PIXEL_ID,
};
