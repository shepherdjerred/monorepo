/** Audited unused Scout keys, retired only in the environment where they exist. */
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
] as const;
