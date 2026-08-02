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
});

describe("knowledge acquisition search", () => {
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

  test("requires the complete acquisition subject in an acquisition passage", () => {
    const base = new KnowledgeBase([
      {
        id: "progression:mach-bike",
        domain: "progression",
        title: "Rydel's Cycles",
        aliases: [],
        tags: [],
        body: "Rydel gives you the Mach Bike or the Acro Bike.",
        sources: [testSource],
      },
      {
        id: "progression:macho-brace",
        domain: "progression",
        title: "Macho Brace reward",
        aliases: [],
        tags: [],
        body: "The family gives you the Macho Brace as a reward.",
        sources: [testSource],
      },
      {
        id: "progression:pokeblock-case",
        domain: "progression",
        title: "Contest Hall receptionist",
        aliases: [],
        tags: [],
        body: "The receptionist gives you a Pokéblock Case.",
        sources: [testSource],
      },
      {
        id: "progression:safari-zone",
        domain: "progression",
        title: "Safari Zone",
        aliases: [],
        tags: [],
        body: "Only Trainers who have received a Pokéblock Case may enter.",
        sources: [testSource],
      },
      {
        id: "progression:feebas",
        domain: "progression",
        title: "Feebas location",
        aliases: [],
        tags: [],
        body: "Feebas can be found on six fishing tiles on Route 119.",
        sources: [testSource],
      },
      {
        id: "progression:itemfinder",
        domain: "progression",
        title: "Itemfinder",
        aliases: [],
        tags: [],
        body: "A rival hands over the Itemfinder.",
        sources: [testSource],
      },
    ]);

    expect(base.search("how to get Mach Bike", { limit: 1 }).at(0)?.id).toBe(
      "progression:mach-bike",
    );
    expect(
      base.search("where to get Pokéblock Case", { limit: 1 }).at(0)?.id,
    ).toBe("progression:pokeblock-case");
    expect(base.search("where to find Feebas", { limit: 1 }).at(0)?.id).toBe(
      "progression:feebas",
    );
  });
});

describe("committed knowledge corpus", () => {
  test("loads core world, species, and battle facts", async () => {
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
  });

  test("finds HM acquisition passages", async () => {
    const base = await loadKnowledgeBase();
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

  test("finds exact item and species acquisition passages", async () => {
    const base = await loadKnowledgeBase();
    expect(base.search("where to find Feebas", { limit: 1 }).at(0)?.id).toBe(
      "progression:bulbapedia:emerald-part-10:1",
    );
    expect(
      base.search("where to get Pokéblock Case", { limit: 1 }).at(0)?.id,
    ).toBe("progression:bulbapedia:emerald-part-13:1");
    expect(base.search("how to get Mach Bike", { limit: 1 }).at(0)?.id).toBe(
      "progression:bulbapedia:emerald-part-5:1",
    );
    expect(base.search("how to get Acro Bike", { limit: 1 }).at(0)?.id).toBe(
      "progression:bulbapedia:emerald-part-5:1",
    );
  });

  test("omits unsupported move priority and battle-card markup", async () => {
    const base = await loadKnowledgeBase();
    expect(
      base.get("progression:bulbapedia:emerald-part-18:1")?.body,
    ).not.toContain("FlyFlyingStatus");
    for (const moveId of [
      "battle:move:extreme-speed",
      "battle:move:fake-out",
      "battle:move:roar",
    ]) {
      expect(base.get(moveId)?.body).not.toContain("Priority:");
    }
  });
});

describe("knowledge location search", () => {
  test("does not treat ordinary location queries as acquisition queries", async () => {
    const base = await loadKnowledgeBase();
    const results = base.search("where is Route 101", {
      domain: "world",
      limit: 5,
    });
    const topResult = results.at(0);
    if (topResult === undefined) {
      throw new Error("expected Route 101 search results");
    }

    expect(topResult.id).toBe("world:region_route101/main");
    expect(topResult.excerpt).toContain("REGION_ROUTE101/MAIN");
    expect(
      results.slice(1).every((result) => result.score < topResult.score),
    ).toBe(true);
  });
});
