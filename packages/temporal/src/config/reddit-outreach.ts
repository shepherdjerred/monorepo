import { defineConfig } from "@shepherdjerred/config";
import { flagValueSchema } from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { z } from "zod/v4";
import { promotionFlagSource } from "./promotion.ts";

const RedditOutreachSettingsSchema = flagValueSchema(
  "the-storm-reddit-outreach-settings",
);
export type RedditOutreachSettings = z.output<
  typeof RedditOutreachSettingsSchema
>;

export const DEFAULT_REDDIT_OUTREACH_SETTINGS: RedditOutreachSettings = {
  subreddits: [
    "MinecraftServer",
    "MinecraftServerFinder",
    "MinecraftSMPs",
    "MinecraftServers",
  ],
  maxPostAgeHours: 24,
  maxPostsPerSweep: 1500,
  maxListingPagesPerSweep: 12,
  maxThreadReadsPerSweep: 20,
  maxRedditNavigationsPerSweep: 60,
  maxRepliesPerSweep: 10,
  maxRepliesPerDay: 10,
};

/** Re-evaluated for each sweep and immediately before submitting a reply. */
export async function redditOutreachConfig() {
  const flags = promotionFlagSource(
    "the-storm-reddit-outreach-prod",
    "the-storm-reddit-outreach-settings",
  );
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "the-storm-reddit-outreach-enabled" },
      },
      settings: {
        schema: RedditOutreachSettingsSchema,
        sources: ["flag", "default"],
        default: JSON.stringify(DEFAULT_REDDIT_OUTREACH_SETTINGS),
        names: { flag: "the-storm-reddit-outreach-settings" },
      },
    } as const,
    sources: flags.sources,
    hooks: flags.hooks,
  });
  const [enabled, settings] = await Promise.all([
    resolver.get("enabled"),
    resolver.get("settings"),
  ]);
  return {
    enabled: flags.available && enabled.value,
    available: flags.available,
    ...settings.value,
    provenance: { enabled: enabled.source, settings: settings.source },
  };
}
