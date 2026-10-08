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
] as const;
