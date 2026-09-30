import type { FeatureTipKey } from "#src/analytics/product-analytics.ts";
import type { FlagName } from "#src/configuration/flags.ts";

/**
 * Adding a tip means adding a key to `FeatureTipKey` (declared in `analytics/`,
 * which owns the closed event-property unions), an entry to `FEATURE_TIPS`, and
 * a usage probe in `tip-eligibility.ts`. The latter two are exhaustive over
 * that type, so a half-added tip does not compile — a tip without a gate would
 * advertise a feature the server cannot use, and one without a usage probe
 * would nag a server that already found it.
 */

/**
 * `flags` are the policy flags a guild needs for the feature to work — ALL of
 * them, and an empty list for a feature every install has. A list rather than
 * a single flag because the Bucks features sit behind their own flag *and*
 * the parent `betting_enabled`: advertising a dare during a betting shutdown
 * would point at an action that rejects.
 */
export type FeatureTip = {
  key: FeatureTipKey;
  flags: readonly FlagName[];
  /**
   * One short sentence. It renders as an embed footer, which Discord caps at
   * 2048 characters but which stops being readable long before that, so these
   * stay near a single line.
   */
  text: string;
};

export const FEATURE_TIPS: readonly FeatureTip[] = [
  {
    key: "competitions",
    flags: [],
    text: "Tip: run a season-long competition with automatic daily leaderboards — set one up in the dashboard.",
  },
  {
    key: "scheduled-reports",
    flags: [],
    text: "Tip: schedule a recurring report and Scout will post your server's stats on its own.",
  },
  {
    key: "queue-filters",
    flags: [],
    text: "Tip: notifications can be filtered per queue, so a channel only hears about the games it cares about.",
  },
  {
    key: "track-more-players",
    flags: [],
    text: "Tip: Scout gets more interesting with more players tracked — add the rest of your group in the dashboard.",
  },
  {
    key: "hall-of-fame",
    flags: ["hall_of_fame_enabled"],
    text: "Tip: turn on the Hall of Fame to keep your server's all-time records.",
  },
  {
    key: "duels",
    flags: ["duels_enabled"],
    text: "Tip: start a duel to run a head-to-head series between two tracked players.",
  },
  {
    key: "dares",
    flags: ["betting_enabled", "bucks_dares_enabled"],
    text: "Tip: `/bb dare` puts a Bryan Bucks bounty on a tracked player's next achievement.",
  },
  {
    key: "transfers",
    flags: ["betting_enabled", "bucks_transfers_enabled"],
    text: "Tip: `/bb transfer` sends Bryan Bucks to someone else in your server.",
  },
  {
    key: "custom-nights",
    flags: ["custom_nights_enabled"],
    text: "Tip: custom nights organise an in-house lobby with balanced teams.",
  },
];

/**
 * Narrow a persisted `tipKey` to a known tip.
 *
 * The catalog is the only source of valid keys, so this cannot drift from it.
 * An unknown key is corrupt persisted state, not a user input: it throws
 * rather than being skipped, because silently dropping it would let a bad row
 * sit in the cooldown window suppressing real tips with nothing to show for it.
 */
export function parseTipKey(value: string): FeatureTipKey {
  const tip = FEATURE_TIPS.find((candidate) => candidate.key === value);
  if (tip === undefined) {
    throw new Error(`Unknown persisted feature tip key: ${value}`);
  }
  return tip.key;
}
