import configuration from "#src/configuration.ts";
import type { ReplayStage } from "#src/explore/replay/dataset.ts";

/**
 * Give flag evaluation the pinned stage's semantics without the stage's config.
 *
 * `ENVIRONMENT` does two things to flags, both prod-only:
 * `isFeatureHardDisabled` short-circuits bucks and dares (`flags.ts:219`), and
 * `applicableOverrides` drops beta-only overrides (`flags.ts:233-238`). A prod
 * run has to see both or it records capabilities prod does not grant.
 *
 * But the same variable also makes `configuration` demand a complete PostHog
 * setup outside dev (`configuration.ts:151-159`) — config neither a capture
 * nor a replay uses, since nothing in either constructs an analytics client.
 *
 * `resolveEnvironment()` is read live on every flag evaluation while
 * `configuration` memoizes once, so touching configuration first pins it under
 * dev and the later flip reaches only the flag path. Narrow and deliberate: it
 * buys prod's flag rules and nothing else, with no invented config values.
 * `replayEnvironmentIssues` enforces the other half, refusing to start if the
 * caller set `ENVIRONMENT` themselves and pre-empted the memoization.
 */
export function useStageFlagSemantics(stage: ReplayStage): void {
  // Force the lazy configuration to compute and memoize while the environment
  // is still whatever the caller supplied.
  void configuration.environment;
  if (stage === "prod") {
    Bun.env["ENVIRONMENT"] = "prod";
  }
}
