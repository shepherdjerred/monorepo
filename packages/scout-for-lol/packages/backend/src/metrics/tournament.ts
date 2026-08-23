import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Tournament-lobby metrics.
 *
 * These carry more weight than usual: nothing past code creation can be
 * validated before the Riot key gains tournament access, so the first real
 * lobby is also the first evidence for most of the "cannot be validated" list
 * in this feature's plan. Read them deliberately after it rather than assuming
 * the stub proved anything.
 */

export const tournamentLobbiesTotal = new Counter({
  name: "scout_tournament_lobbies_total",
  help: "Tournament lobby lifecycle outcomes",
  labelNames: ["action"] as const,
  registers: [registry],
});

export const tournamentLobbyStateGauge = new Gauge({
  name: "scout_tournament_lobby_state",
  help: "Tournament lobbies currently in each lifecycle state",
  labelNames: ["state"] as const,
  registers: [registry],
});

export const tournamentLobbyTransitionsTotal = new Counter({
  name: "scout_tournament_lobby_transitions_total",
  help: "Tournament lobby state transitions",
  labelNames: ["from", "to"] as const,
  registers: [registry],
});

/**
 * Riot event types the lifecycle does not model. Counted rather than logged
 * per occurrence: lobby-events replays its whole list every tick, so a
 * log-per-event would repeat forever for one unknown type.
 */
export const tournamentUnknownLobbyEventsTotal = new Counter({
  name: "scout_tournament_lobby_events_unknown_total",
  help: "Unrecognised tournament lobby event types",
  labelNames: ["event_type"] as const,
  registers: [registry],
});

/**
 * Which prematch path a lobby took.
 *
 * `spectator_enriched` means the opportunistic upgrade landed and the message
 * carries the full loading-screen image; `declared_roster` means it did not and
 * the card shows the rosters from /lobby create. This ratio is the measurement
 * of how reliably spectator sees tournament lobbies — an open question the stub
 * cannot answer.
 */
export const tournamentPrematchTotal = new Counter({
  name: "scout_tournament_prematch_total",
  help: "Tournament prematch notifications by delivery path",
  labelNames: ["path"] as const,
  registers: [registry],
});

/** Whether the lobby's game was linked to a Riot match ID, and how. */
export const tournamentMatchLinkTotal = new Counter({
  name: "scout_tournament_match_link_total",
  help: "Outcomes of linking a tournament lobby to its Riot match",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const tournamentCallbacksTotal = new Counter({
  name: "scout_tournament_callbacks_total",
  help: "Tournament provider callbacks received",
  labelNames: ["status"] as const,
  registers: [registry],
});

/**
 * 0 = stub, 1 = live. A dashboard has to be able to say which API produced the
 * numbers beside it; stub data means nothing about a real lobby.
 */
export const tournamentApiModeGauge = new Gauge({
  name: "scout_tournament_api_mode",
  help: "Tournament API mode in effect (0 = stub, 1 = live)",
  registers: [registry],
});
