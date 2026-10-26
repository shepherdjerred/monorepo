/** Audited unused Scout keys, retired only in the environments where they exist. */
export const retiredFlagDeclarations = [
  { environment: "beta", namespace: "scout", key: "scout-tournament-api-mode" },
  {
    environment: "beta",
    namespace: "scout",
    key: "scout-tournament-max-open-lobbies",
  },
  {
    environment: "beta",
    namespace: "scout",
    key: "tournament_lobbies_enabled",
  },
  { environment: "beta", namespace: "scout", key: "weekly_parlays_enabled" },
  {
    environment: "beta",
    namespace: "scout",
    key: "scout_v2_progression_notifications_enabled",
  },
  {
    environment: "beta",
    namespace: "scout",
    key: "competition_builder_v2_enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "scout_v2_progression_notifications_enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "competition_builder_v2_enabled",
  },
  {
    environment: "beta",
    namespace: "temporal",
    key: "temporal-agent-chat-imessage-enabled",
  },
  {
    environment: "beta",
    namespace: "temporal",
    key: "temporal-agent-chat-imessage-owners",
  },
  {
    environment: "prod",
    namespace: "temporal",
    key: "temporal-agent-chat-imessage-enabled",
  },
  {
    environment: "prod",
    namespace: "temporal",
    key: "temporal-agent-chat-imessage-owners",
  },
  // v1 match pipeline retirement: V2 owns post-match and prematch discovery
  // unconditionally, so neither ownership switch has a reader. Both were base
  // inventory flags, so each exists in both environments.
  {
    environment: "beta",
    namespace: "scout",
    key: "scout_v2_postmatch_ownership_enabled",
  },
  {
    environment: "beta",
    namespace: "scout",
    key: "scout_v2_prematch_ownership_enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "scout_v2_postmatch_ownership_enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "scout_v2_prematch_ownership_enabled",
  },
  // Dare v1/v2 retirement: Dares run only on v3 SQL contracts, so the v2
  // funding gate, extended-contract authoring and relational ScoutQL sources
  // have no reader. Each key was a base inventory flag, so it exists in both
  // environments.
  { environment: "beta", namespace: "scout", key: "dare_v2" },
  {
    environment: "beta",
    namespace: "scout",
    key: "dare_extended_contracts_enabled",
  },
  {
    environment: "beta",
    namespace: "scout",
    key: "scoutql_relational_enabled",
  },
  { environment: "prod", namespace: "scout", key: "dare_v2" },
  {
    environment: "prod",
    namespace: "scout",
    key: "dare_extended_contracts_enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "scoutql_relational_enabled",
  },
  // Bryan Bucks ask no longer selects its own model (reader removed in
  // 1ddf8812fb). It was a base inventory flag, so it exists in both
  // environments.
  { environment: "beta", namespace: "scout", key: "scout-bucks-ask-model" },
  { environment: "prod", namespace: "scout", key: "scout-bucks-ask-model" },
  // Both published report lakes use the current physical schema. The final
  // schema-bridge cleanup removes the rollout reader; bridge images also stop
  // consulting this control once CURRENT points to the current layout.
  {
    environment: "beta",
    namespace: "scout",
    key: "scout-report-lake-schema-upgrade-enabled",
  },
  {
    environment: "prod",
    namespace: "scout",
    key: "scout-report-lake-schema-upgrade-enabled",
  },
  // These flags became unconditional after their readers were removed. Retire
  // the keys from both environments after the parent images are deployed.
  {
    environment: "beta",
    namespace: "storm",
    key: "storm-brain-classify-enabled",
  },
  {
    environment: "beta",
    namespace: "storm",
    key: "storm-brain-triage-enabled",
  },
  {
    environment: "prod",
    namespace: "storm",
    key: "storm-brain-classify-enabled",
  },
  {
    environment: "prod",
    namespace: "storm",
    key: "storm-brain-triage-enabled",
  },
  {
    environment: "beta",
    namespace: "birmel",
    key: "birmel-image-generation-enabled",
  },
  {
    environment: "prod",
    namespace: "birmel",
    key: "birmel-image-generation-enabled",
  },
  {
    environment: "beta",
    namespace: "trmnl-dashboard",
    key: "pet-dashboard-enabled",
  },
  {
    environment: "prod",
    namespace: "trmnl-dashboard",
    key: "pet-dashboard-enabled",
  },
  {
    environment: "beta",
    namespace: "alert-dashboard",
    key: "ops-digest-email-enabled",
  },
  {
    environment: "prod",
    namespace: "alert-dashboard",
    key: "ops-digest-email-enabled",
  },
  // Scout Customs live nights were retired with the Discord Activity; the
  // read-only history page is gated by retained data, not this flag. It was a
  // base inventory flag with a production override, so it exists in both.
  { environment: "beta", namespace: "scout", key: "custom_nights_enabled" },
  { environment: "prod", namespace: "scout", key: "custom_nights_enabled" },
  // Tracker's one-time import endpoints were removed after the cutover, so the
  // import window has no reader. It was a base inventory flag, so it exists in
  // both environments.
  { environment: "beta", namespace: "tracker", key: "tracker-imports-enabled" },
  { environment: "prod", namespace: "tracker", key: "tracker-imports-enabled" },
  // Playlist links are enumerated without an application track cap.
  {
    environment: "beta",
    namespace: "streambot",
    key: "streambot-playlist-limit",
  },
  {
    environment: "prod",
    namespace: "streambot",
    key: "streambot-playlist-limit",
  },
] as const;
