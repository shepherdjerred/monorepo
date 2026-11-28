import path from "node:path";
import { describe, expect, test } from "vitest";
import type { MetaRole } from "@scout-for-lol/data/meta/meta-serving.ts";
import { openSnapshot } from "#src/lib/champion-meta/snapshot-v2-load.ts";
import type {
  MatchupRecord,
  SnapshotMatchup,
} from "#src/lib/champion-meta/snapshot-v2-schema.ts";
import { edgeOf, matchupPageModel, spellFactOf } from "./model.ts";
import { listedMatchups, matchupHref, pageOpponents } from "./pages.ts";

const FIXTURE_INDEX = path.resolve(
  import.meta.dirname,
  "../../../lib/champion-meta/__fixtures__/snapshot-v2/champion-meta/index.json",
);

function rate(value: number, spread: number) {
  return { value, lower: value - spread, upper: value + spread };
}

async function modelFor(
  slug: string,
  role: MetaRole,
  opponent: string,
  edit: (matchup: SnapshotMatchup) => SnapshotMatchup = (matchup) => matchup,
) {
  const snapshot = await openSnapshot(FIXTURE_INDEX);
  const matchup = edit(await snapshot.matchup(slug, role, opponent));
  return matchupPageModel({
    matchup,
    champion: await snapshot.champion(slug),
    opponentChampion: await snapshot.champion(opponent),
    index: snapshot.index,
  });
}

describe("edgeOf", () => {
  test("names a side only when the interval is wholly on it", () => {
    expect(edgeOf(rate(0.56, 0.03))).toBe("champion");
    expect(edgeOf(rate(0.44, 0.03))).toBe("opponent");
    expect(edgeOf(rate(0.52, 0.04))).toBe("even");
  });
});

function pair(
  spellIds: number[],
  games: number,
  value: number,
  spread: number,
): NonNullable<MatchupRecord["spells"]>[number] {
  return {
    spellIds,
    games,
    wins: Math.round(games * value),
    winRate: rate(value, spread),
    share: rate(0.5, 0.05),
    denominator: "matchup_games",
  };
}

describe("spellFactOf", () => {
  test("compares the two most played pairs by the spell that differs", () => {
    const fact = spellFactOf([
      pair([4, 14], 790, 0.469, 0.03),
      pair([4, 12], 240, 0.552, 0.05),
    ]);
    expect(fact?.better).toMatchObject({
      label: "Teleport",
      games: 240,
      winRate: expect.closeTo(55.2, 1),
    });
    expect(fact?.worse).toMatchObject({ label: "Ignite", games: 790 });
  });

  test("says nothing when the intervals overlap or fewer than two pairs exist", () => {
    expect(
      spellFactOf([
        pair([4, 14], 300, 0.5, 0.06),
        pair([4, 12], 200, 0.53, 0.07),
      ]),
    ).toBeNull();
    expect(spellFactOf([pair([4, 14], 300, 0.5, 0.06)])).toBeNull();
    expect(spellFactOf(undefined)).toBeNull();
  });
});

describe("matchupPageModel on the fixture snapshot", () => {
  test("states the games, the window and the bracket", async () => {
    const model = await modelFor("ahri", "MIDDLE", "syndra");
    expect(model.sub).toBe("Ahri wins 52.9% of 679 games against Syndra.");
    expect(model.context).toBe(
      "Mid. From 679 games on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov. Lane figures from 14 to 20 Nov.",
    );
    expect(model.lead).toBe("Neither side has the edge.");
  });

  test("states a lane figure with its own game count", async () => {
    const model = await modelFor("ahri", "MIDDLE", "syndra");
    expect(model.lane).toMatchObject({
      label: "Ahri is ahead at 15 minutes",
      games: 136,
      lead: "Neither side usually gets ahead",
    });
    expect(model.lane?.overall).toMatch(
      /^Against everyone, Ahri is ahead \d+\.\d% of the time, from [\d,]+ games\.$/u,
    );
  });

  test("leaves the lane out of a matchup that has none", async () => {
    const model = await modelFor("ahri", "MIDDLE", "syndra", (matchup) => ({
      ...matchup,
      champion: {
        ...matchup.champion,
        record: { ...matchup.champion.record, lane: undefined },
      },
    }));
    expect(model.lane).toBeNull();
    expect(model.context).not.toContain("Lane figures");
  });

  test("links the other side only when it has a page", async () => {
    const both = await modelFor("ahri", "MIDDLE", "syndra");
    expect(both.otherSide).toEqual({
      href: "/champions/syndra/middle/vs/ahri/",
    });
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const syndra = await snapshot.champion("syndra");
    const matchup = await snapshot.matchup("ahri", "MIDDLE", "syndra");
    const alone = matchupPageModel({
      matchup,
      champion: await snapshot.champion("ahri"),
      opponentChampion: {
        ...syndra,
        matchups: syndra.matchups.map((group) => ({
          ...group,
          opponents: group.opponents.filter((entry) => entry.slug !== "ahri"),
        })),
      },
      index: snapshot.index,
    });
    expect(alone.otherSide).toBeNull();
  });

  test("lists other matchups of the same role, each with a page", async () => {
    const model = await modelFor("ahri", "MIDDLE", "syndra");
    expect(model.others.length).toBeLessThanOrEqual(5);
    expect(model.others.map((row) => row.slug)).not.toContain("syndra");
    for (const row of model.others) {
      expect(row.href).toBe(matchupHref("ahri", "MIDDLE", row.slug));
    }
  });

  test("compares spell pairs when the fixture's intervals separate", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const facts = await Promise.all(
      listedMatchups(await snapshot.champions()).map(async (entry) =>
        matchupPageModel({
          matchup: await snapshot.matchup(
            entry.slug,
            entry.role,
            entry.opponent,
          ),
          champion: await snapshot.champion(entry.slug),
          opponentChampion: await snapshot.champion(entry.opponent),
          index: snapshot.index,
        }),
      ),
    );
    expect(facts.some((model) => model.spellFact !== null)).toBe(true);
  });
});

describe("matchup pages", () => {
  test("exist for exactly the opponents a champion file lists", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const champions = await snapshot.champions();
    const listed = listedMatchups(champions);
    const ahri = champions.find((champion) => champion.slug === "ahri");
    if (ahri === undefined) throw new Error("fixture has Ahri");
    expect([...pageOpponents(ahri, "MIDDLE")].toSorted()).toEqual(
      listed
        .filter((entry) => entry.slug === "ahri" && entry.role === "MIDDLE")
        .map((entry) => entry.opponent)
        .toSorted(),
    );
    expect(pageOpponents(ahri, "TOP").size).toBe(0);
    expect(matchupHref("lee-sin", "JUNGLE", "vi")).toBe(
      "/champions/lee-sin/jungle/vs/vi/",
    );
  });

  test("every listed matchup loads its file", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const listed = listedMatchups(await snapshot.champions());
    expect(listed.length).toBeGreaterThan(100);
    for (const entry of listed) {
      const matchup = await snapshot.matchup(
        entry.slug,
        entry.role,
        entry.opponent,
      );
      expect(matchup.champion.slug).toBe(entry.slug);
      expect(matchup.opponent.slug).toBe(entry.opponent);
    }
  });

  test("a matchup that is not listed is refused", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    await expect(snapshot.matchup("ahri", "TOP", "syndra")).rejects.toThrow(
      "lists no TOP matchup against syndra",
    );
    expect(await snapshot.matchup("ahri", "MIDDLE", "syndra")).toBe(
      await snapshot.matchup("ahri", "MIDDLE", "syndra"),
    );
  });
});
