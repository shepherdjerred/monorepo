import { z } from "zod";
import type { RawLobbyEvent } from "@scout-for-lol/data/index.ts";

/**
 * The lobby lifecycle, as a pure function of the events Riot has shown us.
 *
 * This module has no I/O on purpose. Everything past code creation is
 * unverifiable until the Riot key gains tournament access — stub codes create
 * no real lobby and its events are canned — so the one property the feature
 * genuinely depends on has to be provable here, in CI, rather than observed
 * once in a live Discord server.
 *
 * That property is: **a lobby never notifies twice.**
 *
 * `lobby-events/by-code` replays its entire event list on every call. So the
 * dedup mechanism cannot be event bookkeeping — a stored cursor would have to
 * survive a crash mid-tick, a restart, out-of-order delivery, and ties in a
 * timestamp that Riot sends as a *string* with millisecond resolution. Instead
 * `nextState` recomputes the highest state the whole list implies and emits
 * transitions only for the difference. Entering `champ_select` is what sends
 * the prematch card, and a state is only ever *entered* once, so a replay
 * produces no transitions and therefore no second notification.
 */

export const TournamentLobbyStateSchema = z.enum([
  /** Code minted; Riot has shown us nothing yet. */
  "created",
  /** The in-client lobby exists and players may be joining. */
  "lobby_open",
  /** Champ select began — this is where the prematch card is sent. */
  "champ_select",
  /** Riot is allocating a game server. */
  "allocating",
  /** The game is running. */
  "in_game",
  /** We know the match ID and have written the ActiveGame row. */
  "resolved",
  /** The post-match report was delivered. */
  "reported",
  /** An operator cancelled the lobby. */
  "cancelled",
  /** TTL elapsed before champ select — nobody ever played. */
  "abandoned",
  /** TTL elapsed after champ select without ever resolving to a match. */
  "expired",
]);
export type TournamentLobbyState = z.infer<typeof TournamentLobbyStateSchema>;

/**
 * Rank within the forward progression. Terminal states are deliberately absent:
 * they are not "further along", they are off the path entirely.
 */
const PROGRESSION: readonly TournamentLobbyState[] = [
  "created",
  "lobby_open",
  "champ_select",
  "allocating",
  "in_game",
  "resolved",
  "reported",
];

const TERMINAL_STATES: ReadonlySet<TournamentLobbyState> =
  new Set<TournamentLobbyState>([
    "reported",
    "cancelled",
    "abandoned",
    "expired",
  ]);

export function isTerminal(state: TournamentLobbyState): boolean {
  return TERMINAL_STATES.has(state);
}

function rank(state: TournamentLobbyState): number {
  const index = PROGRESSION.indexOf(state);
  // A terminal-but-not-`reported` state has no rank; callers never compare one,
  // because `nextState` returns early for terminal input.
  return index === -1 ? Number.NaN : index;
}

/** Known Riot lobby-event types, and the state each one implies. */
const EVENT_IMPLIES: Readonly<Record<string, TournamentLobbyState>> = {
  PracticeGameCreatedEvent: "lobby_open",
  PlayerJoinedGameEvent: "lobby_open",
  PlayerSwitchedTeamEvent: "lobby_open",
  PlayerQuitGameEvent: "lobby_open",
  ChampSelectStartedEvent: "champ_select",
  GameAllocationStartedEvent: "allocating",
  GameAllocatedToLsmEvent: "in_game",
};

export type LobbyTransition = {
  readonly from: TournamentLobbyState;
  readonly to: TournamentLobbyState;
};

export type NextStateResult = {
  readonly state: TournamentLobbyState;
  /** Empty when nothing changed — which is the whole point on a replay. */
  readonly transitions: readonly LobbyTransition[];
  /** Players currently in the lobby, replayed from join/quit events. */
  readonly joinedPuuids: readonly string[];
  /** Event types we do not model, for a metric. Never fatal. */
  readonly unknownEventTypes: readonly string[];
};

/**
 * Replays join and quit events in the order Riot listed them.
 *
 * Unlike the state, this is allowed to shrink: someone who leaves the lobby is
 * no longer in it.
 */
function replayMembership(events: readonly RawLobbyEvent[]): string[] {
  const present = new Set<string>();
  for (const event of events) {
    if (event.eventType === "PlayerJoinedGameEvent") {
      present.add(event.puuid);
    } else if (event.eventType === "PlayerQuitGameEvent") {
      present.delete(event.puuid);
    }
  }
  return [...present];
}

function impliedState(events: readonly RawLobbyEvent[]): {
  state: TournamentLobbyState;
  unknownEventTypes: string[];
} {
  let highest: TournamentLobbyState = "created";
  const unknown = new Set<string>();

  for (const event of events) {
    const implied = EVENT_IMPLIES[event.eventType];
    if (implied === undefined) {
      // Not fatal, and not even unusual — Riot may add an event type at any
      // time. Modelling eventType as an enum would have failed the parse and
      // taken this lobby's poll down permanently.
      unknown.add(event.eventType);
      continue;
    }
    if (rank(implied) > rank(highest)) {
      highest = implied;
    }
  }

  return { state: highest, unknownEventTypes: [...unknown] };
}

export type NextStateInput = {
  readonly current: TournamentLobbyState;
  readonly events: readonly RawLobbyEvent[];
  readonly now: Date;
  readonly expiresAt: Date;
};

/**
 * The next state for a lobby, given everything Riot has shown us.
 *
 * Idempotent over a replay and monotonic: the returned state is never earlier
 * in the progression than `current`, so a state cannot be re-entered and its
 * side effect cannot fire twice.
 */
export function nextState(input: NextStateInput): NextStateResult {
  const { current, events, now, expiresAt } = input;

  // A finished lobby is finished. Riot will happily keep serving its event
  // list forever, and none of it can revive a cancelled or reported lobby.
  if (isTerminal(current)) {
    return {
      state: current,
      transitions: [],
      joinedPuuids: replayMembership(events),
      unknownEventTypes: [],
    };
  }

  const { state: implied, unknownEventTypes } = impliedState(events);
  const advanced = rank(implied) > rank(current) ? implied : current;
  const joinedPuuids = replayMembership(events);

  // TTL is evaluated against the state we just advanced to, not the one we
  // came in with: a lobby whose champ select started microseconds before its
  // deadline is "expired", not "abandoned", and the two mean different things
  // to an operator reading /lobby status.
  if (now.getTime() >= expiresAt.getTime()) {
    const timedOut: TournamentLobbyState =
      rank(advanced) >= rank("champ_select") ? "expired" : "abandoned";
    return {
      state: timedOut,
      transitions: [{ from: current, to: timedOut }],
      joinedPuuids,
      unknownEventTypes,
    };
  }

  if (advanced === current) {
    return { state: current, transitions: [], joinedPuuids, unknownEventTypes };
  }

  // One transition per state actually crossed, so a poll that misses a tick
  // still reports champ_select rather than jumping silently to in_game. The
  // prematch send keys off the champ_select transition and would otherwise be
  // skipped entirely for a fast lobby.
  const transitions: LobbyTransition[] = [];
  for (let step = rank(current); step < rank(advanced); step += 1) {
    const from = PROGRESSION[step];
    const to = PROGRESSION[step + 1];
    if (from === undefined || to === undefined) break;
    transitions.push({ from, to });
  }

  return { state: advanced, transitions, joinedPuuids, unknownEventTypes };
}

/** Whether this set of transitions crosses into champ select. */
export function entersChampSelect(
  transitions: readonly LobbyTransition[],
): boolean {
  return transitions.some((transition) => transition.to === "champ_select");
}

/** Whether this set of transitions crosses into a running game. */
export function entersInGame(transitions: readonly LobbyTransition[]): boolean {
  return transitions.some((transition) => transition.to === "in_game");
}
