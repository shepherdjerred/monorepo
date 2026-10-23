import { describe, expect, it } from "vitest";
import {
  MIN_ACCURACY,
  MIN_SHOTS_PER_MINUTE,
  RANGED_KITS,
  cards,
  readMatch,
  recordsHits,
  totals,
} from "./archery-report.ts";

const row = (...fields: (string | number)[]) => fields.join("\t");
const shots = (who: string, count: number, from: number) =>
  Array.from({ length: count }, (_, i) =>
    row("J", from + i * 10, who, "arrow", 0, 64, 0, 1, 0, 0),
  );

/**
 * Two minutes of a recorded match: three bot archers, a crossbow, a trooper and
 * a human. `capable` writes the start row declaring hit events, `withHits` the
 * hit rows and `kills` the deaths credited to a killer.
 */
function recording({
  capable = true,
  withHits = capable,
  kills = true,
}: { capable?: boolean; withHits?: boolean; kills?: boolean } = {}): string[] {
  const hits = withHits
    ? [
        row("E", 300, "hit", "archer", "trooper;projectile;Projectile;4.50"),
        row("E", 400, "hit", "archer", "trooper;projectile;Projectile;4.50"),
        row("E", 500, "hit", "archer", "human;projectile;Projectile;4.50"),
        // A teammate and a sword blow are not arrows on an enemy.
        row("E", 550, "hit", "archer", "sloth;projectile;Projectile;4.50"),
        row("E", 560, "hit", "archer", "trooper;melee;Melee;1.00"),
      ]
    : [];
  return [
    row("H", 4, "match-1", "frostline", "sha", 1, "rwf-combat-1"),
    row("R", "archer", "RED", "longbow", "true"),
    row("R", "sloth", "RED", "shortbow", "true"),
    row("R", "early", "RED", "longbow", "true"),
    row("R", "trooper", "BLUE", "trooper", "true"),
    row("R", "bolt", "BLUE", "arbalist", "true"),
    row("R", "human", "BLUE", "shortbow", "false"),
    ...(capable ? [row("E", 0, "capabilities", "match", "hits")] : []),
    row("E", 0, "joined", "archer", "RED"),
    ...shots("archer", 10, 100),
    ...shots("sloth", 4, 100),
    ...shots("human", 30, 100),
    ...shots("bolt", 3, 100),
    ...hits,
    row("E", 600, "died", "early", kills ? "trooper Melee" : "- Void"),
    row("E", 700, "died", "trooper", kills ? "archer Projectile" : "- Void"),
    row("X", 2400, "RED", "LAST_TEAM_STANDING"),
  ];
}

describe("archery report card", () => {
  it("reads the ranged kits the kit book exports", () => {
    expect(RANGED_KITS.get("longbow")).toMatchObject({ ammo: "infinite" });
    expect(RANGED_KITS.get("arbalist")).toMatchObject({
      weapon: "crossbow",
      ammo: "finite",
      arrows: 48,
    });
    expect(RANGED_KITS.has("trooper")).toBe(false);
  });

  it("judges Infinity-bow bots on hits, shots per minute and accuracy", () => {
    const match = readMatch(recording());
    const byName = new Map(cards(match).map((card) => [card.pseudonym, card]));

    expect(byName.get("archer")).toMatchObject({
      secondsAlive: 120,
      died: false,
      shots: 10,
      shotsPerMinute: 5,
      hits: 3,
      accuracy: 0.3,
      verdict: "PASS",
      failures: [],
    });
    expect(byName.get("sloth")).toMatchObject({
      shots: 4,
      shotsPerMinute: 2,
      hits: 0,
      verdict: "FAIL",
      failures: ["no-hit", "slow", "inaccurate"],
    });
    // Thirty seconds alive is too short to judge.
    expect(byName.get("early")).toMatchObject({
      secondsAlive: 30,
      died: true,
      verdict: "-",
    });
    // Limited arrows and humans are reported, never judged.
    expect(byName.get("bolt")).toMatchObject({ shots: 3, verdict: "-" });
    expect(byName.get("human")).toMatchObject({ shots: 30, verdict: "-" });
    expect(byName.has("trooper")).toBe(false);
    expect(MIN_SHOTS_PER_MINUTE).toBeGreaterThan(2);
    expect(MIN_SHOTS_PER_MINUTE).toBeLessThanOrEqual(5);
    expect(MIN_ACCURACY).toBeLessThanOrEqual(0.3);
  });

  it("sums a team's bots", () => {
    const red = cards(readMatch(recording())).filter(
      (card) => card.team === "RED",
    );
    expect(totals(red)).toMatchObject({
      members: 3,
      judged: 2,
      passed: 1,
      failed: 1,
      shots: 14,
      hits: 3,
    });
  });

  it.each([
    ["with a credited kill", true],
    ["without a credited kill", false],
  ])(
    "calls hits unknown, not zero, in a recording that predates hit events, %s",
    (_, kills) => {
      const match = readMatch(recording({ capable: false, kills }));
      expect(recordsHits(match)).toBe(false);
      const byName = new Map(
        cards(match).map((card) => [card.pseudonym, card]),
      );
      expect(byName.get("archer")).toMatchObject({
        hits: undefined,
        accuracy: undefined,
        verdict: "UNKNOWN",
      });
      // Too slow fails whatever the hits were.
      expect(byName.get("sloth")).toMatchObject({
        verdict: "FAIL",
        failures: ["slow"],
      });
    },
  );

  it("judges a recording that declares hit events but landed none", () => {
    const match = readMatch(
      recording({ capable: true, withHits: false, kills: false }),
    );
    expect(recordsHits(match)).toBe(true);
    const byName = new Map(cards(match).map((card) => [card.pseudonym, card]));
    expect(byName.get("archer")).toMatchObject({
      hits: 0,
      accuracy: 0,
      verdict: "FAIL",
      failures: ["no-hit", "inaccurate"],
    });
  });

  it("rejects a malformed capability", () => {
    expect(() =>
      readMatch([
        row("H", 4, "match-1", "frostline"),
        row("E", 0, "capabilities", "match", "hits,"),
      ]),
    ).toThrow();
  });

  it("rejects a malformed hit row", () => {
    expect(() =>
      readMatch([
        row("H", 4, "match-1", "frostline"),
        row("E", 1, "hit", "archer", "trooper;arrow;Projectile;4.50"),
      ]),
    ).toThrow();
  });
});
