import { describe, expect, test } from "vitest";
import {
  LIVE_NOW,
  liveGameFixture,
  liveListFixture,
  twoFriendsFixture,
} from "#src/lib/live/live-fixtures.ts";
import {
  championLine,
  displayName,
  elapsedLabel,
  laneOpponent,
  liveHeroLines,
  liveListLead,
  orderedTeams,
  queueLabel,
  queueSentence,
  rankLabel,
  rankOf,
  summaryFriendLine,
  summaryLine,
} from "#src/lib/live/live-game.ts";
import { watchLines } from "#src/lib/live/live-watch.ts";
import { runeItem, spellItem } from "#src/lib/live/live-kit.ts";
import { isGameNotFound } from "#src/lib/live/live-errors.ts";

const MINUTE = 60_000;

function at(minutes: number, seconds = 0): Date {
  return new Date(
    Date.parse("2026-06-01T20:00:00.000Z") + minutes * MINUTE + seconds * 1000,
  );
}

describe("elapsedLabel", () => {
  const detectedAt = "2026-06-01T20:00:40.000Z";

  test("counts whole minutes from the start", () => {
    const startedAt = "2026-06-01T20:00:00.000Z";
    expect(elapsedLabel({ startedAt, detectedAt, now: at(0, 59) })).toBe(
      "just started",
    );
    expect(elapsedLabel({ startedAt, detectedAt, now: at(1) })).toBe(
      "1 minute in",
    );
    expect(elapsedLabel({ startedAt, detectedAt, now: at(6, 30) })).toBe(
      "6 minutes in",
    );
    expect(elapsedLabel({ startedAt, detectedAt, now: at(60) })).toBe(
      "1 hour in",
    );
    expect(elapsedLabel({ startedAt, detectedAt, now: at(125) })).toBe(
      "2 hours 5 minutes in",
    );
  });

  test("a lobby with no start time counts from detection", () => {
    expect(elapsedLabel({ startedAt: null, detectedAt, now: at(4, 40) })).toBe(
      "4 minutes in",
    );
  });

  test("never reads a clock that is behind the start as negative", () => {
    expect(
      elapsedLabel({
        startedAt: "2026-06-01T20:10:00.000Z",
        detectedAt,
        now: at(0),
      }),
    ).toBe("just started");
  });
});

describe("queues and ranks", () => {
  test("names the queue a game is in", () => {
    expect(queueLabel(420)).toBe("Ranked Solo");
    expect(queueLabel(440)).toBe("Ranked Flex");
    expect(queueLabel(450)).toBe("ARAM");
    expect(queueSentence(420)).toBe("A Ranked Solo game.");
    expect(queueSentence(450)).toBe("An ARAM game.");
  });

  test("labels ranks with a division except at the top", () => {
    const base = { division: 1, lp: 22, wins: 1, losses: 1 } as const;
    expect(rankLabel({ ...base, tier: "emerald" })).toBe("Emerald I");
    expect(rankLabel({ ...base, division: 3, tier: "gold" })).toBe("Gold III");
    expect(rankLabel({ ...base, tier: "master" })).toBe("Master");
  });

  test("a friend's rank is the one held at detection, a stranger's the one read since", () => {
    const { participants } = liveGameFixture();
    const friend = participants[2];
    const stranger = participants[6];
    const unread = participants[9];
    expect(friend === undefined ? null : rankOf(friend)?.tier).toBe("emerald");
    expect(stranger === undefined ? null : rankOf(stranger)?.division).toBe(1);
    expect(unread === undefined ? undefined : rankOf(unread)).toBeNull();
  });
});

describe("teams", () => {
  test("the friend's team comes first, each team from top to support", () => {
    const teams = orderedTeams(liveGameFixture());
    expect(teams.map((team) => team.title)).toEqual([
      "RiverQuartz's team",
      "Their team",
    ]);
    expect(
      teams[0]?.participants.map((participant) => championLine(participant)),
    ).toEqual([
      "Garen, top",
      "Vi, jungle",
      "Ahri, mid",
      "Caitlyn, bot",
      "Leona, support",
    ]);
    expect(teams[1]?.participants.map((p) => p.lane)).toEqual([
      "top",
      "jungle",
      "middle",
      "adc",
      "support",
    ]);
  });

  test("a lobby with no lanes keeps Riot's order and names no lane", () => {
    const game = liveGameFixture();
    const unlaned = {
      ...game,
      participants: game.participants.map((participant) => ({
        ...participant,
        lane: null,
      })),
    };
    const [mine] = orderedTeams(unlaned);
    expect(
      mine?.participants.map((participant) => championLine(participant)),
    ).toEqual(["Garen", "Vi", "Ahri", "Caitlyn", "Leona"]);
  });

  test("two friends on a team share its title", () => {
    expect(orderedTeams(twoFriendsFixture())[0]?.title).toBe(
      "Quillon and RiverQuartz's team",
    );
  });

  test("a hidden player is shown as hidden", () => {
    const [first] = liveGameFixture().participants;
    expect(
      first === undefined ? "" : displayName({ ...first, riotId: null }),
    ).toBe("Hidden");
  });

  test("a lane's opponent is the one in the same lane on the other team", () => {
    const game = liveGameFixture();
    const ahri = game.participants[2];
    const opponent = ahri === undefined ? undefined : laneOpponent(game, ahri);
    expect(opponent?.riotId).toBe("Lowtide#NA1");
  });
});

describe("liveHeroLines", () => {
  test("says who is playing what, against whom and for how long", () => {
    expect(liveHeroLines(liveGameFixture(), LIVE_NOW)).toEqual({
      title: "RiverQuartz",
      lead: "Playing Ahri in mid against Syndra, 6 minutes in.",
      sub: "A Ranked Solo game.",
      championId: 103,
    });
  });

  test("a game that is over is told in the past and carries no clock", () => {
    const lines = liveHeroLines(liveGameFixture({ ended: true }), LIVE_NOW);
    expect(lines.lead).toBe("Played Ahri in mid against Syndra.");
  });

  test("with no lane the sentence names the champion alone", () => {
    const game = liveGameFixture();
    const unlaned = {
      ...game,
      participants: game.participants.map((participant) => ({
        ...participant,
        lane: null,
      })),
    };
    expect(liveHeroLines(unlaned, LIVE_NOW).lead).toBe(
      "Playing Ahri, 6 minutes in.",
    );
  });

  test("several friends share the sentence", () => {
    const lines = liveHeroLines(twoFriendsFixture(), LIVE_NOW);
    expect(lines.title).toBe("Quillon and RiverQuartz");
    expect(lines.lead).toBe("Playing Garen and Ahri, 6 minutes in.");
  });

  test("a roster with no friend in it is a broken contract", () => {
    const game = liveGameFixture();
    expect(() =>
      liveHeroLines(
        {
          ...game,
          participants: game.participants.map((participant) => ({
            ...participant,
            friend: null,
          })),
        },
        LIVE_NOW,
      ),
    ).toThrow("has no friend in it");
  });
});

describe("watchLines", () => {
  test("a winning run leads, then a champion they have not played lately", () => {
    expect(watchLines(liveGameFixture())).toEqual([
      {
        championId: 234,
        before: "Their jungler,",
        name: "Hushwing",
        after: "has won 5 in a row.",
      },
      {
        championId: 134,
        before: "Their mid laner,",
        name: "Lowtide",
        after: "has not played Syndra in their last 5 ranked games.",
      },
    ]);
  });

  test("says nothing about players whose form was never read", () => {
    const game = liveGameFixture();
    const bare = {
      ...game,
      participants: game.participants.map((participant) => ({
        ...participant,
        recentForm: null,
      })),
    };
    expect(watchLines(bare)).toEqual([]);
  });

  test("says nothing about a stranger whose games Riot would not show", () => {
    const game = liveGameFixture();
    const hidden = game.participants.map((participant) =>
      participant.recentForm?.status === "fetched"
        ? {
            ...participant,
            recentForm: {
              status: "unavailable" as const,
              recordedAt: "2026-06-01T20:01:00.000Z",
            },
          }
        : participant,
    );
    expect(watchLines({ ...game, participants: hidden })).toEqual([]);
  });

  test("never names the friend's own team", () => {
    const names = watchLines(liveGameFixture()).map((line) => line.name);
    expect(names).not.toContain("Ironbark");
  });
});

describe("the list", () => {
  const games = liveListFixture();

  test("names who is playing", () => {
    expect(liveListLead(games)).toBe(
      "RiverQuartz and 2 friends are in a game right now.",
    );
    expect(liveListLead(games.slice(0, 1))).toBe(
      "RiverQuartz is in a game right now.",
    );
  });

  test("a game reads as its queue and how long it has gone", () => {
    expect(games[0] && summaryLine(games[0], LIVE_NOW)).toBe(
      "Ranked Solo, 6 minutes in",
    );
    expect(games[1] && summaryLine(games[1], LIVE_NOW)).toBe(
      "ARAM, 1 minute in",
    );
  });

  test("a friend reads as the champion and lane they are on", () => {
    const [first] = games;
    expect(first?.friends[0] && summaryFriendLine(first.friends[0])).toBe(
      "as Ahri in mid",
    );
    expect(games[1]?.friends[0] && summaryFriendLine(games[1].friends[0])).toBe(
      "as Jinx",
    );
  });
});

describe("the kit", () => {
  test("draws a spell and a keystone from the game assets", () => {
    expect(spellItem(4)).toEqual({
      asset: { kind: "spell", key: "SummonerFlash" },
      name: "Flash",
    });
    expect(runeItem(8112)).toEqual({
      asset: { kind: "rune", key: "Electrocute" },
      name: "Electrocute",
    });
  });

  test("an id nothing knows fails loudly rather than drawing a blank", () => {
    expect(() => spellItem(99_999)).toThrow("Unknown summoner spell id");
    expect(() => runeItem(99_999)).toThrow("Unknown rune id");
  });
});

describe("isGameNotFound", () => {
  test("recognises the server's no-such-game answer and nothing else", () => {
    expect(isGameNotFound({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(isGameNotFound({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isGameNotFound(new Error("offline"))).toBe(false);
    expect(isGameNotFound(null)).toBe(false);
  });
});
