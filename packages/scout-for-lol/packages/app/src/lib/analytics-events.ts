/**
 * The closed catalog of what the Scout SPA may send to PostHog.
 *
 * Split from `analytics.ts` because it is data, not behaviour: that module is
 * about identity, consent, and emission, and the two change for entirely
 * different reasons. Both halves are deliberately allowlists — an event or
 * property that is not named here cannot be sent, which is what keeps the
 * registry bounded and free of Discord, Riot, or free-text identifiers.
 */

/** Every product-analytics event the app can emit. */
const SCOUT_ANALYTICS_EVENTS = [
  // Reports
  "report_created",
  "report_updated",
  "report_deleted",
  "report_run",
  "report_enabled_toggled",
  // ScoutQL editor
  "report_preset_used",
  "data_explorer_action",
  // AI editor
  "ai_edit_started",
  "ai_edit_applied",
  "ai_edit_cancelled",
  "ai_edit_error",
  // Subscriptions
  "subscription_add",
  "subscription_removed",
  "subscription_muted",
  "subscription_unmuted",
  "subscription_filters_set",
  "subscription_channel_filters_set",
  "subscription_channel_added",
  "subscription_moved",
  // Players
  "player_account_added",
  "player_account_edited",
  "player_account_transferred",
  "player_account_deleted",
  "player_discord_linked",
  "player_discord_unlinked",
  "player_renamed",
  "players_merged",
  "player_deleted",
  // Competitions
  "competition_created",
  "competition_edited",
  "competition_cancelled",
  "competition_participant_invited",
  "competition_members_added_all",
  "competition_participant_removed",
  "competition_leaderboard_refreshed",
  // Explore
  "explore_turn_started",
  "explore_turn_finished",
  "explore_shared",
  "explore_share_revoked",
  "explore_conversation_renamed",
  "explore_conversation_deleted",
  "explore_branch_selected",
  "explore_exported",
  // Access (RBAC)
  "access_granted",
  "access_updated",
  "access_revoked",
  // Funnel / entry
  "onboarding_step",
  "onboarding_completed",
  "onboarding_skipped",
  "bot_install_click",
  "bot_install_completed",
  "login_click",
  "sign_out",
  "theme_changed",
  // Feedback prompt
  "feedback_shown",
  "feedback_submitted",
  "feedback_dismissed",
] as const;

export type ScoutAnalyticsEvent = (typeof SCOUT_ANALYTICS_EVENTS)[number];

export const ANALYTICS_EVENT_NAMES: ReadonlySet<string> = new Set(
  SCOUT_ANALYTICS_EVENTS,
);

/**
 * Only these properties may be sent to PostHog. All are low-cardinality
 * except `guild_id`, the one documented identifier: it is the privacy-policy
 * disclosed join between a browser session and a bot installation, and on
 * `bot_install_completed` its value is the server-echoed mutation response,
 * never a raw query parameter.
 */
export type AnalyticsProperty =
  | "guild_id"
  | "outcome"
  | "reason"
  | "kind"
  | "category"
  | "preference"
  | "skin"
  | "mode_preference"
  | "resolved_mode"
  | "surface"
  | "action"
  | "step"
  | "has_existing_query";

export type AnalyticsProps = Partial<
  Record<AnalyticsProperty, string | number | boolean>
>;
