import { describe, expect, test } from "bun:test";
import { KnowledgeBase, loadKnowledgeBase } from "./knowledge.ts";

const testSource = {
  id: "pokeapi" as const,
  url: "https://example.com/source",
  license: "test",
  revision: "abc",
};

describe("KnowledgeBase", () => {
  test("ranks title and alias matches above body-only matches", () => {
    const base = new KnowledgeBase([
      {
        id: "species:ralts",
        domain: "species",
        title: "Ralts",
        aliases: ["National Dex 280"],
        tags: ["psychic"],
        body: "A Pokémon found on Route 102.",
        sources: [testSource],
      },
      {
        id: "world:route-102",
        domain: "world",
        title: "Route 102",
        aliases: [],
        tags: ["grass"],
        body: "Ralts can appear here.",
        sources: [testSource],
      },
    ]);

    expect(
      base.search("ralts", { limit: 2 }).map((result) => result.id),
    ).toEqual(["species:ralts", "world:route-102"]);
  });

  test("filters by domain and bounds results", () => {
    const base = new KnowledgeBase([
      {
        id: "species:ralts",
        domain: "species",
        title: "Ralts",
        aliases: [],
        tags: ["psychic"],
        body: "A Pokémon.",
        sources: [testSource],
      },
      {
        id: "items:potion",
        domain: "items",
        title: "Potion",
        aliases: [],
        tags: ["healing"],
        body: "Restores a Pokémon's HP.",
        sources: [testSource],
      },
    ]);

    expect(
      base
        .search("restores pokemon", { domain: "items", limit: 1 })
        .map((result) => result.id),
    ).toEqual(["items:potion"]);
  });

  test("keeps accented canonical names within one search token", () => {
    const base = new KnowledgeBase([
      {
        id: "items:pokeblock-case",
        domain: "items",
        title: "Pokeblock Case",
        aliases: ["pokeblock-case"],
        tags: [],
        body: "A case for holding Pokeblocks.",
        sources: [testSource],
      },
      {
        id: "battle:move:block",
        domain: "battle",
        title: "Block",
        aliases: ["block"],
        tags: [],
        body: "A battle move.",
        sources: [testSource],
      },
    ]);

    expect(
      base.search("Pokéblock Case", { limit: 2 }).map((result) => result.id),
    ).toEqual(["items:pokeblock-case"]);
  });

  test("ranks acquisition evidence above repeated usage mentions", () => {
    const base = new KnowledgeBase([
      {
        id: "progression:strength-uses",
        domain: "progression",
        title: "Strength route cleanup",
        aliases: [],
        tags: [],
        body: "Use Strength here. Strength opens this path. Return with Strength later.",
        sources: [testSource],
      },
      {
        id: "progression:strength-acquisition",
        domain: "progression",
        title: "Rusturf Tunnel reward",
        aliases: [],
        tags: [],
        body: "As thanks, he gives you HM04 (Strength).",
        sources: [testSource],
      },
      {
        id: "progression:unrelated-reward",
        domain: "progression",
        title: "Unrelated reward",
        aliases: [],
        tags: [],
        body: "The champion rewards you with a Potion. Strength opens a path.",
        sources: [testSource],
      },
    ]);

    expect(
      base
        .search("how to get strength", { limit: 3 })
        .map((result) => result.id),
    ).toEqual([
      "progression:strength-acquisition",
      "progression:strength-uses",
      "progression:unrelated-reward",
    ]);
  });

  test("loads and searches the committed corpus", async () => {
    const base = await loadKnowledgeBase();
    const results = base.search("Route 101 wild encounter", {
      domain: "world",
      limit: 3,
    });
    expect(results.length).toBe(3);
    expect(results.some((result) => result.title === "ROUTE101/MAIN")).toBe(
      true,
    );
    expect(base.get("species:ralts")?.body).toContain("Types: psychic\n");
    expect(base.get("species:ralts")?.body).not.toContain("fairy");
    expect(base.get("battle:move:tackle")?.body).toContain(
      "Power: 35; accuracy: 95",
    );
    expect(base.get("battle:move:crunch")?.body).toContain(
      "Generation III damage class: special",
    );
    const expectedShedinjaSourceIds = ["pokeapi", "pokeemerald-wasm"];
    expect(
      base.get("species:nincada")?.sources.map((source) => source.id),
    ).toEqual(expectedShedinjaSourceIds);
    expect(
      base.get("species:shedinja")?.sources.map((source) => source.id),
    ).toEqual(expectedShedinjaSourceIds);
    const nincadaSearchResult = base
      .search("nincada", { domain: "species", limit: 5 })
      .find((result) => result.id === "species:nincada");
    expect(nincadaSearchResult?.excerpt).toContain(
      "only with an empty party slot",
    );
    expect(nincadaSearchResult?.sources.map((source) => source.id)).toEqual(
      expectedShedinjaSourceIds,
    );
    const surfResults = base.search("how to get surf", { limit: 3 });
    expect(
      surfResults.some(
        (result) =>
          result.domain === "progression" &&
          result.excerpt.includes("HM03 (Surf)"),
      ),
    ).toBe(true);
    const strengthResults = base.search("how to get strength", {
      domain: "progression",
      limit: 5,
    });
    expect(strengthResults.at(0)?.id).toBe(
      "progression:bulbapedia:emerald-part-5:2",
    );
    expect(strengthResults.at(0)?.excerpt).toContain("HM04 (Strength)");
    const flyResults = base.search("how to get fly", {
      domain: "progression",
      limit: 5,
    });
    expect(flyResults.at(0)?.id).toBe(
      "progression:bulbapedia:emerald-part-10:1",
    );
    expect(flyResults.at(0)?.excerpt).toContain("HM02 (Fly)");
    const rockSmashResults = base.search("where to get HM06 Rock Smash", {
      domain: "progression",
      limit: 5,
    });
    expect(rockSmashResults.at(0)?.id).toBe(
      "progression:hm06-rock-smash-acquisition-emerald",
    );
    expect(rockSmashResults.at(0)?.excerpt).toContain(
      "obtain HM06 (Rock Smash)",
    );
    expect(rockSmashResults.at(0)?.excerpt).toContain("Mauville City");
  });
});
