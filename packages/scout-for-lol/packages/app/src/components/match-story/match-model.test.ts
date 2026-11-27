import { describe, expect, test } from "vitest";
import {
  MATCH_FIXTURE_NOW,
  matchDetailFixture,
} from "#src/components/match-story/match-page.fixture.ts";
import {
  compactNumber,
  friendsOf,
  heroText,
  joinNames,
  laneDetail,
  laneLead,
  laneResultOf,
  lpSentence,
  positionLabel,
  relativeTime,
  resultOf,
  viewerOf,
} from "#src/components/match-story/match-model.ts";

function setup(options: Parameters<typeof matchDetailFixture>[0] = {}) {
  const { match } = matchDetailFixture(options);
  return { match, viewer: viewerOf(match) };
}

describe("match model", () => {
  test("names the viewer's result, and a remake has none", () => {
    const won = setup();
    expect(resultOf(won.match, won.viewer)).toBe("win");
    const lost = setup({ viewerOnRed: true });
    expect(resultOf(lost.match, lost.viewer)).toBe("loss");
    const remade = setup({ remake: true });
    expect(resultOf(remade.match, remade.viewer)).toBe("remake");
  });

  test("a match with no selected player is a broken contract", () => {
    const { match } = matchDetailFixture();
    const stripped = {
      ...match,
      teams: match.teams.map((team) => ({
        ...team,
        participants: team.participants.map((participant) => ({
          ...participant,
          selectedPlayer: false,
        })),
      })),
    };
    expect(() => viewerOf(stripped)).toThrow("no selected player");
  });

  test("friends are the tracked teammates, never the viewer or opponents", () => {
    const { match, viewer } = setup();
    expect(
      friendsOf(match, viewer).map((friend) => friend.championName),
    ).toEqual(["Jinx", "Thresh"]);
  });

  test("hero text states the result, score, friends, LP and queue", () => {
    const { match, viewer } = setup();
    expect(
      heroText({ match, viewer, queue: "Ranked Solo", now: MATCH_FIXTURE_NOW }),
    ).toEqual({
      title: "Northstar won as Ahri",
      lead: "9/2/11 in a 28-minute game, with RiverQuartz and TidalWren.",
      sub: "Up 21 LP to Emerald II, 64 LP. Ranked Solo, 2 hours ago.",
    });
  });

  test("hero text leaves the LP out when no snapshot was captured", () => {
    const { match, viewer } = setup({ lp: "none" });
    expect(
      heroText({ match, viewer, queue: "Ranked Solo", now: MATCH_FIXTURE_NOW })
        .sub,
    ).toBe("Ranked Solo, 2 hours ago.");
  });

  test("a remake says so and shows no LP", () => {
    const { match, viewer } = setup({ remake: true });
    const text = heroText({
      match,
      viewer,
      queue: "Ranked Solo",
      now: MATCH_FIXTURE_NOW,
    });
    expect(text.title).toBe("Northstar played Ahri");
    expect(text.sub).toBe("Remade, no result. Ranked Solo, 2 hours ago.");
  });

  test("LP is stated as the snapshots give it, never estimated", () => {
    const { viewer } = setup();
    expect(lpSentence(viewer.lpDelta)).toBe("Up 21 LP to Emerald II, 64 LP.");
    expect(lpSentence(null)).toBeNull();
    const unknown = setup({ lp: "unknown" }).viewer.lpDelta;
    expect(lpSentence(unknown)).toBe("Now Emerald II, 64 LP.");
    if (viewer.lpDelta === null) throw new Error("fixture has no LP");
    expect(lpSentence({ ...viewer.lpDelta, delta: -18 })).toBe(
      "Down 18 LP to Emerald II, 64 LP.",
    );
    expect(lpSentence({ ...viewer.lpDelta, delta: 0 })).toBe(
      "No LP change, Emerald II, 64 LP.",
    );
  });

  test("the lane at 15 minutes is read from the viewer's side", () => {
    const blue = setup();
    const lane = laneResultOf(blue.match, blue.viewer);
    expect(lane?.opponent.championName).toBe("Yasuo");
    expect(lane === null ? "" : laneLead(lane)).toBe(
      "Ahead of Yasuo at 15 minutes, by 640 gold.",
    );
    expect(lane === null ? "" : laneDetail(lane)).toBe(
      "14 more minions, 320 more experience",
    );
    const red = setup({ viewerOnRed: true });
    const redLane = laneResultOf(red.match, red.viewer);
    expect(redLane?.goldDelta).toBe(640);
  });

  test("level lane figures read as one sentence", () => {
    const { match, viewer } = setup();
    const lane = laneResultOf(match, viewer);
    if (lane === null) throw new Error("fixture has no lane");
    expect(laneDetail({ ...lane, creepScoreDelta: 0, xpDelta: -80 })).toBe(
      "Same minions, 80 fewer experience",
    );
    expect(laneDetail({ ...lane, creepScoreDelta: 3, xpDelta: 0 })).toBe(
      "3 more minions, same experience",
    );
  });

  test("a lane behind or level is said plainly", () => {
    const { match, viewer } = setup();
    const lane = laneResultOf(match, viewer);
    if (lane === null) throw new Error("fixture has no lane");
    expect(laneLead({ ...lane, goldDelta: -310 })).toBe(
      "Behind Yasuo at 15 minutes, by 310 gold.",
    );
    expect(laneLead({ ...lane, goldDelta: 0 })).toBe(
      "Even with Yasuo at 15 minutes.",
    );
  });

  test("no timeline and a remake have no lane result", () => {
    const noTimeline = setup({ timeline: false });
    expect(laneResultOf(noTimeline.match, noTimeline.viewer)).toBeNull();
    const remade = setup({ remake: true });
    expect(laneResultOf(remade.match, remade.viewer)).toBeNull();
  });

  test("small formatting helpers", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(18_400)).toBe("18.4K");
    expect(compactNumber(1_250_000)).toBe("1.3M");
    expect(positionLabel("MIDDLE")).toBe("mid");
    expect(positionLabel("BOTTOM")).toBe("bot");
    expect(positionLabel("")).toBeNull();
    expect(relativeTime(MATCH_FIXTURE_NOW - 120_000, MATCH_FIXTURE_NOW)).toBe(
      "2 minutes ago",
    );
    expect(relativeTime(MATCH_FIXTURE_NOW - 40_000, MATCH_FIXTURE_NOW)).toBe(
      "just now",
    );
    expect(
      relativeTime(MATCH_FIXTURE_NOW - 40 * 86_400_000, MATCH_FIXTURE_NOW),
    ).toBe("Oct 18, 2026");
  });
});
