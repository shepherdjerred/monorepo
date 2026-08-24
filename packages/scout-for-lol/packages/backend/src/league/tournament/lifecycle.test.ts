import { describe, expect, test } from "vitest";
import type { RawLobbyEvent } from "@scout-for-lol/data/index.ts";
import {
  entersChampSelect,
  entersInGame,
  isTerminal,
  nextState,
  TournamentLobbyStateSchema,
  type TournamentLobbyState,
} from "#src/league/tournament/lifecycle.ts";

const NOW = new Date("2026-08-23T00:00:00Z");
const NOT_YET = new Date("2026-08-23T03:00:00Z");
const ALREADY = new Date("2026-08-22T23:00:00Z");

function event(eventType: string, puuid = "player-one"): RawLobbyEvent {
  return { timestamp: "1780816258099", eventType, puuid };
}

const CREATED = event("PracticeGameCreatedEvent");
const JOIN_ONE = event("PlayerJoinedGameEvent", "player-one");
const JOIN_TWO = event("PlayerJoinedGameEvent", "player-two");
const CHAMP_SELECT = event("ChampSelectStartedEvent");
const ALLOCATING = event("GameAllocationStartedEvent");
const IN_GAME = event("GameAllocatedToLsmEvent");

function advance(
  current: TournamentLobbyState,
  events: readonly RawLobbyEvent[],
  options: { expiresAt?: Date } = {},
) {
  return nextState({
    current,
    events,
    now: NOW,
    expiresAt: options.expiresAt ?? NOT_YET,
  });
}

describe("nextState — progression", () => {
  test("an empty event list leaves a fresh lobby alone", () => {
    const result = advance("created", []);
    expect(result.state).toBe("created");
    expect(result.transitions).toEqual([]);
  });

  test("a created lobby opens", () => {
    expect(advance("created", [CREATED]).state).toBe("lobby_open");
  });

  test("champ select advances and reports the crossing", () => {
    const result = advance("lobby_open", [CREATED, JOIN_ONE, CHAMP_SELECT]);
    expect(result.state).toBe("champ_select");
    expect(entersChampSelect(result.transitions)).toBe(true);
  });

  test("a lobby that skipped a tick still reports champ select", () => {
    // The poller can miss the champ-select window entirely on a fast blind
    // pick. Emitting one transition per state crossed means the prematch send,
    // which keys off entering champ_select, still fires.
    const result = advance("created", [
      CREATED,
      CHAMP_SELECT,
      ALLOCATING,
      IN_GAME,
    ]);
    expect(result.state).toBe("in_game");
    expect(entersChampSelect(result.transitions)).toBe(true);
    expect(entersInGame(result.transitions)).toBe(true);
  });
});

describe("nextState — idempotence over a replay", () => {
  // This is the property the whole feature rests on. lobby-events replays its
  // entire list every call, so if a replay could re-emit a transition the
  // prematch card would be sent again on every 20-second tick.
  const EVENT_LISTS: readonly RawLobbyEvent[][] = [
    [],
    [CREATED],
    [CREATED, JOIN_ONE],
    [CREATED, JOIN_ONE, JOIN_TWO, CHAMP_SELECT],
    [CREATED, CHAMP_SELECT, ALLOCATING],
    [CREATED, CHAMP_SELECT, ALLOCATING, IN_GAME],
    [IN_GAME, CHAMP_SELECT, CREATED],
    [event("SomeFutureRiotEvent"), CREATED, CHAMP_SELECT],
  ];

  test.each(TournamentLobbyStateSchema.options)(
    "applying the same list twice from %s emits nothing the second time",
    (start) => {
      for (const events of EVENT_LISTS) {
        const first = advance(start, events);
        const second = advance(first.state, events);
        expect(second.transitions).toEqual([]);
        expect(second.state).toBe(first.state);
      }
    },
  );

  test.each(TournamentLobbyStateSchema.options)(
    "never moves backwards from %s",
    (start) => {
      const order = TournamentLobbyStateSchema.options;
      for (const events of EVENT_LISTS) {
        const result = advance(start, events);
        if (isTerminal(start)) {
          expect(result.state).toBe(start);
          continue;
        }
        // Either it stayed put, advanced along the progression, or timed out.
        const progressed =
          order.indexOf(result.state) >= order.indexOf(start) ||
          isTerminal(result.state);
        expect(progressed).toBe(true);
      }
    },
  );

  test("event order does not change the outcome", () => {
    // Riot's ordering is not a documented guarantee, and multiple events can
    // share a millisecond in a timestamp that arrives as a string.
    const forwards = advance("created", [CREATED, CHAMP_SELECT, IN_GAME]);
    const backwards = advance("created", [IN_GAME, CHAMP_SELECT, CREATED]);
    expect(backwards.state).toBe(forwards.state);
  });

  test("a shrinking event list cannot rewind the state", () => {
    const full = advance("created", [CREATED, CHAMP_SELECT, IN_GAME]);
    // Riot serving less than it did last tick must not undo a notification.
    const shrunk = advance(full.state, [CREATED]);
    expect(shrunk.state).toBe("in_game");
    expect(shrunk.transitions).toEqual([]);
  });
});

describe("nextState — terminal states", () => {
  test.each(["reported", "cancelled", "abandoned", "expired"] as const)(
    "%s absorbs any further events",
    (terminal) => {
      const result = advance(terminal, [CREATED, CHAMP_SELECT, IN_GAME]);
      expect(result.state).toBe(terminal);
      expect(result.transitions).toEqual([]);
    },
  );

  test("a terminal lobby is not resurrected by an expiry check", () => {
    const result = advance("cancelled", [CREATED], { expiresAt: ALREADY });
    expect(result.state).toBe("cancelled");
  });
});

describe("nextState — TTL", () => {
  test("a lobby nobody played is abandoned", () => {
    const result = advance("lobby_open", [CREATED, JOIN_ONE], {
      expiresAt: ALREADY,
    });
    expect(result.state).toBe("abandoned");
  });

  test("a lobby that reached champ select expires instead", () => {
    // The two mean different things to an operator: abandoned is "nobody
    // played", expired is "they played and we never linked the match".
    const result = advance("lobby_open", [CREATED, CHAMP_SELECT], {
      expiresAt: ALREADY,
    });
    expect(result.state).toBe("expired");
  });

  test("expiry is judged against the state the events imply, not the stored one", () => {
    // The stored state is still lobby_open, but this tick's events say champ
    // select already happened.
    const result = advance("created", [CHAMP_SELECT], { expiresAt: ALREADY });
    expect(result.state).toBe("expired");
  });
});

describe("nextState — membership", () => {
  test("replays joins", () => {
    const result = advance("created", [CREATED, JOIN_ONE, JOIN_TWO]);
    expect(result.joinedPuuids.toSorted()).toEqual([
      "player-one",
      "player-two",
    ]);
  });

  test("a quit removes the player, unlike the state which only advances", () => {
    const result = advance("created", [
      CREATED,
      JOIN_ONE,
      JOIN_TWO,
      event("PlayerQuitGameEvent", "player-one"),
    ]);
    expect(result.joinedPuuids).toEqual(["player-two"]);
    // The lobby is still open — a player leaving does not rewind the lifecycle.
    expect(result.state).toBe("lobby_open");
  });

  test("a rejoin after a quit counts", () => {
    const result = advance("created", [
      JOIN_ONE,
      event("PlayerQuitGameEvent", "player-one"),
      JOIN_ONE,
    ]);
    expect(result.joinedPuuids).toEqual(["player-one"]);
  });
});

describe("nextState — unknown event types", () => {
  test("are reported but never fatal", () => {
    const result = advance("created", [
      CREATED,
      event("SomeFutureRiotEvent"),
      CHAMP_SELECT,
    ]);
    expect(result.state).toBe("champ_select");
    expect(result.unknownEventTypes).toEqual(["SomeFutureRiotEvent"]);
  });

  test("are deduplicated, because the list is replayed every tick", () => {
    const result = advance("created", [
      event("SomeFutureRiotEvent"),
      event("SomeFutureRiotEvent"),
      event("SomeFutureRiotEvent"),
    ]);
    expect(result.unknownEventTypes).toEqual(["SomeFutureRiotEvent"]);
  });
});
