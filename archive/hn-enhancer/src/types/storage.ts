import { z } from "zod/v4";

export const SentimentFilterSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["dim", "hide", "label"]).default("dim"),
  threshold: z.enum(["low", "medium", "high"]).default("medium"),
  useLLM: z.boolean().default(true),
});

export const GreenAccountSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  ageDays: z.number().default(14),
});

export const ReplyNotifierSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  pollIntervalMinutes: z.number().default(15),
  myUsername: z.string().default(""),
});

export const SettingsSchema = z.object({
  hideUsers: z.object({ enabled: z.boolean().default(true) }),
  sentimentFilter: SentimentFilterSettingsSchema,
  hideGreenAccounts: GreenAccountSettingsSchema,
  replyNotifier: ReplyNotifierSettingsSchema,
  debug: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  hideUsers: { enabled: true },
  sentimentFilter: {
    enabled: false,
    mode: "dim",
    threshold: "medium",
    useLLM: true,
  },
  hideGreenAccounts: { enabled: false, ageDays: 14 },
  replyNotifier: { enabled: true, pollIntervalMinutes: 15, myUsername: "" },
  debug: false,
};

export const LLMCacheEntrySchema = z.object({
  negative: z.boolean(),
  confidence: z.number(),
  timestamp: z.number(),
});

export type LLMCacheEntry = z.infer<typeof LLMCacheEntrySchema>;

export const LocalStateSchema = z.object({
  replyCount: z.number().default(0),
  lastSeenItemId: z.number().default(0),
  lastPolledAt: z.number().default(0),
});

export type LocalState = z.infer<typeof LocalStateSchema>;

export const HiddenUsersSchema = z.array(z.string());

export const DEFAULT_LOCAL_STATE: LocalState = {
  replyCount: 0,
  lastSeenItemId: 0,
  lastPolledAt: 0,
};
