import { z } from "zod";

/**
 * The closed set of product events the Scout desktop client may send, and the
 * only properties each may carry. The language-neutral source of truth is
 * `desktop-events.contract.json`; the Rust client validates the same contract
 * and fixtures, and `desktop-events.schema.test.ts` fails if either drifts.
 *
 * Every property is a bounded enum. There is deliberately no free-text field,
 * so a path, Riot ID, PUUID or token has nowhere to travel.
 */
export const SCOUT_DESKTOP_EVENTS_PATH = "/api/scout-client/v1/desktop/events";

/** Semantic version with optional pre-release; bounded and path-free. */
const AppVersionSchema = z
  .string()
  .max(64)
  .regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-z0-9.-]{1,32})?$/i);

export const ScoutDesktopPlatformSchema = z.enum([
  "windows",
  "macos",
  "linux",
  "other",
]);
export const ScoutDesktopWindowCrashCauseSchema = z.enum([
  "exited",
  "unresponsive",
  "protocol_mismatch",
  "launch_failed",
]);
export const ScoutDesktopWindowCrashOutcomeSchema = z.enum([
  "relaunched",
  "gave_up",
  "not_relaunched",
]);

const CommonPropertiesSchema = z.strictObject({
  platform: ScoutDesktopPlatformSchema,
});

const WindowCrashedPropertiesSchema = z.strictObject({
  platform: ScoutDesktopPlatformSchema,
  cause: ScoutDesktopWindowCrashCauseSchema,
  outcome: ScoutDesktopWindowCrashOutcomeSchema,
});

export const ScoutDesktopEventSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("app_started"),
    appVersion: AppVersionSchema,
    properties: CommonPropertiesSchema,
  }),
  z.strictObject({
    event: z.literal("device_paired"),
    appVersion: AppVersionSchema,
    properties: CommonPropertiesSchema,
  }),
  z.strictObject({
    event: z.literal("post_game_reported"),
    appVersion: AppVersionSchema,
    properties: CommonPropertiesSchema,
  }),
  z.strictObject({
    event: z.literal("update_applied"),
    appVersion: AppVersionSchema,
    properties: CommonPropertiesSchema,
  }),
  z.strictObject({
    event: z.literal("window_crashed"),
    appVersion: AppVersionSchema,
    properties: WindowCrashedPropertiesSchema,
  }),
]);

export type ScoutDesktopEvent = z.infer<typeof ScoutDesktopEventSchema>;
export type ScoutDesktopEventName = ScoutDesktopEvent["event"];
