import { describe, test, expect } from "vitest";
import {
  classifyGame,
  isArenaQueueOrMode,
  isClassicQueueType,
  parseQueueType,
  queueTypeToDisplayString,
  resolveQueueTypeFromGame,
  type QueueType,
} from "./state.ts";

describe("parseQueueType", () => {
  // Every queue id the parser recognises. Source of truth is
  // https://static.developer.riotgames.com/docs/lol/queues.json
  // — keep this table in sync when adding rotating modes.
  const cases: readonly (readonly [number, QueueType])[] = [
    [400, "draft pick"],
    [420, "solo"],
    [440, "flex"],
    [450, "aram"],
    [480, "swiftplay"],
    [490, "quickplay"],
    [700, "clash"],
    [710, "ranked 5s"],
    [720, "aram clash"],
    [900, "arurf"],
    [1700, "arena"],
    [1740, "arena"],
    [1750, "arena"],
    [1900, "urf"],
    [2300, "brawl"],
    [3260, "normal"],
    [3262, "normal"],
    [870, "co-op vs ai"],
    [880, "co-op vs ai"],
    [890, "co-op vs ai"],
    [4310, "classic"],
    [2400, "aram mayhem"],
    [2450, "classic aram mayhem"],
    [3200, "aram mayhem"],
    [3220, "aram mayhem"],
    [3270, "aram mayhem"],
    [3280, "classic aram mayhem"],
    [4250, "easy doom bots"],
    [4240, "normal doom bots"],
    [4220, "hard doom bots"],
    [4260, "hard doom bots"],
  ];

  test.each(cases)("queue id %i parses to %s", (id, expected) => {
    expect(parseQueueType(id)).toBe(expected);
  });

  test("returns undefined for unknown queue id", () => {
    expect(parseQueueType(99_999)).toBeUndefined();
  });

  test.each([0, 3100, 3130])(
    "queue id %i names no queue by itself",
    (queueId) => {
      expect(parseQueueType(queueId)).toBeUndefined();
    },
  );
});

describe("Arena queue resolution", () => {
  test("treats CHERRY custom-shaped games as arena", () => {
    expect(isArenaQueueOrMode(0, "CHERRY")).toBe(true);
    expect(resolveQueueTypeFromGame(0, "CHERRY")).toBe("arena");
  });

  test("keeps ordinary custom games as custom", () => {
    expect(isArenaQueueOrMode(0, "CLASSIC")).toBe(false);
    expect(resolveQueueTypeFromGame(0, "CLASSIC", "CUSTOM_GAME")).toBe(
      "custom",
    );
    expect(resolveQueueTypeFromGame(0, "CLASSIC")).toBeUndefined();
  });

  test("treats queue 1700 as arena even with a different mode string", () => {
    expect(isArenaQueueOrMode(1700, "UNKNOWN")).toBe(true);
    expect(resolveQueueTypeFromGame(1700, "UNKNOWN")).toBe("arena");
  });

  // Regression: Riot moved live Arena from queue 1700 -> 1750 around mid-2026.
  // The report lake flattened `queue` via bare parseQueueType, which only knew
  // 1700, so every 1750 game landed with queue=null and vanished from the
  // `queue IN ('arena')` reports. Both the direct id map and the CHERRY-mode
  // classifier must now recognise 1750.
  test.each([1740, 1750])(
    "treats reworked Arena queue %i as arena even with an unknown mode",
    (queueId) => {
      expect(parseQueueType(queueId)).toBe("arena");
      expect(isArenaQueueOrMode(queueId, "UNKNOWN")).toBe(true);
      expect(resolveQueueTypeFromGame(queueId, "UNKNOWN")).toBe("arena");
    },
  );

  test("treats the reworked queue 1750 (CHERRY) as arena", () => {
    expect(parseQueueType(1750)).toBe("arena");
    expect(isArenaQueueOrMode(1750, "CHERRY")).toBe(true);
    expect(resolveQueueTypeFromGame(1750, "CHERRY")).toBe("arena");
    // Even if Riot churns the id again, CHERRY mode still resolves to arena.
    expect(resolveQueueTypeFromGame(1760, "CHERRY")).toBe("arena");
  });
});

describe("League Classic queue resolution", () => {
  test("resolves queue 4310 as Classic", () => {
    expect(parseQueueType(4310)).toBe("classic");
  });

  test("resolves the exact CLASSIC mode and legacy JADE alias as Classic", () => {
    expect(resolveQueueTypeFromGame(4310, "CLASSIC")).toBe("classic");
    expect(resolveQueueTypeFromGame(4310, "JADE")).toBe("classic");
    expect(resolveQueueTypeFromGame(0, "JADE", "CUSTOM_GAME")).toBe("classic");
  });

  test.each([3260, 3262])(
    "resolves ordinary CLASSIC queue %i as normal",
    (queueId) => {
      expect(parseQueueType(queueId)).toBe("normal");
      expect(resolveQueueTypeFromGame(queueId, "CLASSIC")).toBe("normal");
      expect(
        classifyGame({
          queueId,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
        }),
      ).toEqual(queue("normal"));
    },
  );

  test.each([870, 880, 890])(
    "classifies Co-op vs AI queue %i as co-op vs ai",
    (queueId) => {
      expect(
        classifyGame({
          queueId,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
        }),
      ).toEqual(queue("co-op vs ai"));
    },
  );

  test.each([800, 810, 820, 830, 840, 850])(
    "leaves retired Co-op vs AI queue %i unmapped",
    (queueId) => {
      expect(
        classifyGame({
          queueId,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
        }).kind,
      ).toBe("unknown");
    },
  );

  test.each([2450, 3280])(
    "resolves queue %i as Classic ARAM Mayhem",
    (queueId) => {
      expect(parseQueueType(queueId)).toBe("classic aram mayhem");
      expect(resolveQueueTypeFromGame(queueId, "CLASSIC ARAM MAYHEM")).toBe(
        "classic aram mayhem",
      );
    },
  );

  test("preserves the historical KIWI_JADE alias for Classic ARAM Mayhem", () => {
    expect(resolveQueueTypeFromGame(2450, "KIWI_JADE")).toBe(
      "classic aram mayhem",
    );
  });

  test("keeps unknown custom CLASSIC games custom", () => {
    expect(resolveQueueTypeFromGame(0, "CLASSIC", "CUSTOM_GAME")).toBe(
      "custom",
    );
    expect(resolveQueueTypeFromGame(3110, "CLASSIC", "CUSTOM")).toBe("custom");
  });

  test("never labels queue ids 0, 3100 or 3130 custom without the custom game type", () => {
    for (const queueId of [0, 3100, 3130]) {
      expect(
        resolveQueueTypeFromGame(queueId, "CLASSIC", "MATCHED_GAME"),
      ).toBeUndefined();
      expect(resolveQueueTypeFromGame(queueId, "CLASSIC")).toBeUndefined();
      expect(resolveQueueTypeFromGame(queueId, "CLASSIC", "CUSTOM_GAME")).toBe(
        "custom",
      );
    }
  });

  test("keeps Clash on its queue id when Spectator reports gameType CUSTOM", () => {
    // Live Clash spectator payloads are CUSTOM with queue 700/720, not
    // MATCHED_GAME. The mapped queue id must win so the loading screen stays
    // Clash rather than collapsing to a generic custom lobby.
    expect(resolveQueueTypeFromGame(700, "CLASSIC", "CUSTOM")).toBe("clash");
    expect(resolveQueueTypeFromGame(720, "ARAM", "CUSTOM")).toBe("aram clash");
  });

  test("identifies both dedicated Classic queue types", () => {
    expect(isClassicQueueType("classic")).toBe(true);
    expect(isClassicQueueType("classic aram mayhem")).toBe(true);
    expect(isClassicQueueType("aram mayhem")).toBe(false);
    expect(isClassicQueueType(undefined)).toBe(false);
  });
});

describe("custom games with unmapped queue IDs", () => {
  // Regression: real custom Summoner's Rift game 5576694431 reported
  // gameQueueConfigId 3110 (absent from queues.json). Without the gameType
  // signal this resolved to undefined and the loading-screen image fell back
  // to a plain text embed.
  test("resolves an unmapped queue ID to custom when gameType is CUSTOM", () => {
    expect(parseQueueType(3110)).toBeUndefined();
    expect(resolveQueueTypeFromGame(3110, "CLASSIC", "CUSTOM")).toBe("custom");
    expect(resolveQueueTypeFromGame(3110, "CLASSIC", "CUSTOM")).not.toBe(
      undefined,
    );
  });

  test("also matches Match V5 CUSTOM_GAME game type", () => {
    expect(resolveQueueTypeFromGame(3110, "CLASSIC", "CUSTOM_GAME")).toBe(
      "custom",
    );
  });

  test("does not classify an unknown matched CLASSIC queue as Classic", () => {
    expect(resolveQueueTypeFromGame(3110, "CLASSIC", "MATCHED")).toBe(
      undefined,
    );
  });

  test("does not mislabel an unmapped non-custom queue as custom", () => {
    expect(
      resolveQueueTypeFromGame(99_999, "UNKNOWN", "MATCHED"),
    ).toBeUndefined();
  });
});

describe("queueTypeToDisplayString", () => {
  const cases: readonly (readonly [QueueType, string])[] = [
    ["solo", "ranked solo"],
    ["flex", "ranked flex"],
    ["ranked 5s", "ranked 5s"],
    ["clash", "Clash"],
    ["aram clash", "ARAM Clash"],
    ["aram", "ARAM"],
    ["arurf", "ARURF"],
    ["urf", "URF"],
    ["arena", "arena"],
    ["classic", "League Classic"],
    ["classic aram mayhem", "Classic ARAM Mayhem"],
    ["brawl", "brawl"],
    ["aram mayhem", "ARAM: Mayhem"],
    ["draft pick", "draft pick"],
    ["quickplay", "quickplay"],
    ["swiftplay", "swiftplay"],
    ["easy doom bots", "Easy Doom Bots"],
    ["normal doom bots", "Normal Doom Bots"],
    ["hard doom bots", "Hard Doom Bots"],
    ["custom", "custom"],
    ["tournament", "tournament"],
    ["co-op vs ai", "Co-op vs AI"],
  ];

  test.each(cases)("%s renders as %s", (queueType, expected) => {
    expect(queueTypeToDisplayString(queueType)).toBe(expected);
  });
});

const unknown = (
  queueId: number,
  gameMode: string,
  gameType: string | undefined,
) => ({ kind: "unknown", queueId, gameMode, gameType });
const queue = (value: QueueType) => ({ kind: "queue", queue: value });

describe("classifyGame", () => {
  test("a user-created lobby is custom", () => {
    expect(
      classifyGame({
        queueId: 0,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
      }),
    ).toEqual(queue("custom"));
    expect(
      classifyGame({ queueId: 3110, gameMode: "CLASSIC", gameType: "CUSTOM" }),
    ).toEqual(queue("custom"));
    expect(
      classifyGame({
        queueId: 0,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
        tournamentCode: "",
      }),
    ).toEqual(queue("custom"));
  });

  test("a tournament code makes the game a tournament game", () => {
    expect(
      classifyGame({
        queueId: 0,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
        tournamentCode: "NA0a1b2-tournament",
      }),
    ).toEqual(queue("tournament"));
  });

  test("Clash stays Clash on a custom game type, even with a tournament code", () => {
    expect(
      classifyGame({
        queueId: 700,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
        tournamentCode: "x",
      }),
    ).toEqual(queue("clash"));
  });

  test("ARAM Clash stays ARAM Clash on a custom game type", () => {
    expect(
      classifyGame({ queueId: 720, gameMode: "ARAM", gameType: "CUSTOM" }),
    ).toEqual(queue("aram clash"));
  });

  test("Practice Tool is unknown, not custom", () => {
    expect(
      classifyGame({
        queueId: 0,
        gameMode: "PRACTICETOOL",
        gameType: "CUSTOM_GAME",
      }),
    ).toEqual(unknown(0, "PRACTICETOOL", "CUSTOM_GAME"));
  });

  test("an unmapped queue on a matchmade game is unknown", () => {
    expect(
      classifyGame({
        queueId: 99_999,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
      }),
    ).toEqual(unknown(99_999, "CLASSIC", "MATCHED_GAME"));
  });

  test.each([0, 3100, 3130])(
    "queue id %i is custom only with the custom game type",
    (queueId) => {
      expect(
        classifyGame({
          queueId,
          gameMode: "CLASSIC",
          gameType: "CUSTOM_GAME",
        }),
      ).toEqual(queue("custom"));
      expect(
        classifyGame({
          queueId,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
        }),
      ).toEqual(unknown(queueId, "CLASSIC", "MATCHED_GAME"));
      expect(classifyGame({ queueId, gameMode: "CLASSIC" })).toEqual(
        unknown(queueId, "CLASSIC", undefined),
      );
    },
  );

  test("ordinary queues keep their mapping", () => {
    expect(
      classifyGame({
        queueId: 420,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
      }),
    ).toEqual(queue("solo"));
  });
});
