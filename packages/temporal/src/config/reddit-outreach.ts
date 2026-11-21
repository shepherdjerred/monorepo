import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

export const RedditOutreachSettingsSchema = z.strictObject({
  subreddits: z
    .array(z.string().regex(/^\w{3,21}$/u))
    .min(1)
    .max(10)
    .refine(
      (names) =>
        new Set(names.map((name) => name.toLowerCase())).size === names.length,
      "Subreddit names must be unique",
    ),
  maxPostAgeHours: z.number().int().min(1).max(24),
  maxPostsPerSweep: z.number().int().min(1).max(1500),
  maxListingPagesPerSweep: z.number().int().min(1).max(100).default(12),
  maxThreadReadsPerSweep: z.number().int().min(1).max(100).default(20),
  maxRedditNavigationsPerSweep: z.number().int().min(1).max(300).default(60),
  maxRepliesPerSweep: z.number().int().min(0).max(10),
  maxRepliesPerDay: z.number().int().min(0).max(10),
});
export type RedditOutreachSettings = z.infer<
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
  const availability = { value: true };
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "the-storm-reddit-outreach-enabled" },
      },
      settings: {
        schema: z
          .string()
          .transform((value, context) => {
            try {
              const parsed: unknown = JSON.parse(value);
              return parsed;
            } catch {
              context.addIssue({
                code: "custom",
                message: "Expected Reddit outreach settings JSON",
              });
              return z.NEVER;
            }
          })
          .pipe(RedditOutreachSettingsSchema),
        sources: ["flag", "default"],
        default: JSON.stringify(DEFAULT_REDDIT_OUTREACH_SETTINGS),
        names: { flag: "the-storm-reddit-outreach-settings" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "the-storm-reddit-outreach-prod",
        attributes: { environment: "prod" },
        kinds: { enabled: "boolean", settings: "string" },
        requireFreshSnapshot: true,
        onUnavailable: () => {
          availability.value = false;
        },
      }),
    },
    hooks: {
      onSourceError: () => {
        availability.value = false;
      },
    },
  });
  const [enabled, settings] = await Promise.all([
    resolver.get("enabled"),
    resolver.get("settings"),
  ]);
  return {
    enabled: availability.value && enabled.value,
    available: availability.value,
    ...settings.value,
    provenance: { enabled: enabled.source, settings: settings.source },
  };
}
