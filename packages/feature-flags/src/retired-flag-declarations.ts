/**
 * Flipt keys removed from the managed inventory, retired only in the
 * environments where they exist. A key deleted from the inventory without a
 * declaration here stays live in Flipt and the inventory check reports it as
 * drift ("Flipt keys absent from the inventory").
 *
 * The first four are audited unused beta keys. The two Scout V2 ownership
 * switches were declared in every environment and lost their readers when V2
 * took over prematch and post-match ownership unconditionally.
 */
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
] as const;
