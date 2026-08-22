import { describe, expect, test } from "vitest";
import { selectParlayMarketForAlias } from "#src/betting/parlay-market-selection.ts";

function market(matchId: string, aliases: readonly string[]) {
  return {
    matchId,
    definition: {
      subjects: JSON.stringify(
        aliases.map((alias, index) => ({
          key: `P${(index + 1).toString()}`,
          puuid: `puuid-${matchId}-${index.toString()}`.padEnd(78, "x"),
          alias,
        })),
      ),
    },
  };
}

describe("selectParlayMarketForAlias", () => {
  test("selects the only matching market case-insensitively", () => {
    const selected = selectParlayMarketForAlias(
      [market("NA1_1", ["Bryan"]), market("NA1_2", ["Jerred"])],
      "bRyAn",
    );

    expect(selected).toEqual({
      kind: "selected",
      market: market("NA1_1", ["Bryan"]),
    });
  });

  test("rejects an alias shared by multiple open matches", () => {
    expect(
      selectParlayMarketForAlias(
        [market("NA1_2", ["Bryan"]), market("NA1_1", ["Bryan", "Jerred"])],
        "Bryan",
      ),
    ).toEqual({ kind: "ambiguous", matchIds: ["NA1_1", "NA1_2"] });
  });

  test("reports the unique available aliases when none match", () => {
    expect(
      selectParlayMarketForAlias(
        [market("NA1_1", ["Jerred", "Bryan"]), market("NA1_2", ["Bryan"])],
        "Nope",
      ),
    ).toEqual({
      kind: "not_found",
      availableAliases: ["Bryan", "Jerred"],
    });
  });
});
