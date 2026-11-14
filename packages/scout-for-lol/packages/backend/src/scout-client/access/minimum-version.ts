import {
  ScoutClientUpgradeRequiredSchema,
  type ScoutClientUpgradeRequired,
} from "@scout-for-lol/data";
import {
  scoutClientMinimumVersion,
  SemanticVersionSchema,
} from "#src/config/dynamic.ts";

/**
 * The typed refusal for a Scout Client build older than the configured
 * minimum, or `null` when the build is supported.
 *
 * A version that is not a semantic version cannot be shown to meet the
 * minimum, so it is refused the same way: every released build reports its
 * Cargo package version.
 */
export function clientUpgradeRequired(
  appVersion: string,
): ScoutClientUpgradeRequired | null {
  const minimumVersion = scoutClientMinimumVersion();
  const supported =
    SemanticVersionSchema.safeParse(appVersion).success &&
    Bun.semver.order(appVersion, minimumVersion) >= 0;
  return supported
    ? null
    : ScoutClientUpgradeRequiredSchema.parse({
        error: "client_upgrade_required",
        minimumVersion,
      });
}
