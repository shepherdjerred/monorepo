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
 * `flag` is the policy flag that makes the feature available, or "always" for
 * a feature every install has. Availability is never assumed: a tip whose
 * flag is off for the guild is not a candidate.
 */
export type FeatureTip = {
  key: FeatureTipKey;
  flag: FlagName | "always";
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
    flag: "always",
    text: "Tip: run a season-long competition with automatic daily leaderboards — set one up in the dashboard.",
  },
  {
    key: "scheduled-reports",
    flag: "always",
    text: "Tip: schedule a recurring report and Scout will post your server's stats on its own.",
  },
  {
    key: "queue-filters",
    flag: "always",
    text: "Tip: notifications can be filtered per queue, so a channel only hears about the games it cares about.",
  },
  {
    key: "track-more-players",
    flag: "always",
    text: "Tip: Scout gets more interesting with more players tracked — add the rest of your group in the dashboard.",
  },
  {
    key: "hall-of-fame",
    flag: "hall_of_fame_enabled",
    text: "Tip: turn on the Hall of Fame to keep your server's all-time records.",
  },
  {
    key: "duels",
    flag: "duels_enabled",
    text: "Tip: start a duel to run a head-to-head series between two tracked players.",
  },
  {
    key: "dares",
    flag: "bucks_dares_enabled",
    text: "Tip: `/bb dare` puts a Bryan Bucks bounty on a tracked player's next achievement.",
  },
  {
    key: "transfers",
    flag: "bucks_transfers_enabled",
    text: "Tip: `/bb transfer` sends Bryan Bucks to someone else in your server.",
  },
  {
    key: "custom-nights",
    flag: "custom_nights_enabled",
    text: "Tip: custom nights organise an in-house lobby with balanced teams.",
  },
  {
    key: "tournament-lobbies",
    flag: "tournament_lobbies_enabled",
    text: "Tip: `/lobby create` runs a tournament-code custom game with full post-game reports.",
  },
];
