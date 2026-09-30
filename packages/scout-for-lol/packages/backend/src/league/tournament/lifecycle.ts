import { z } from "zod";

/** Historical Tournament API lobby states retained for old database rows. */
export const TournamentLobbyStateSchema = z.enum([
  "created",
  "lobby_open",
  "champ_select",
  "allocating",
  "in_game",
  "resolved",
  "reported",
  "cancelled",
  "abandoned",
  "expired",
]);

export type TournamentLobbyState = z.infer<typeof TournamentLobbyStateSchema>;
