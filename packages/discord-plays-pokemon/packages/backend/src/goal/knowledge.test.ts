import { describe, expect, test } from "bun:test";
import { KnowledgeBase, loadKnowledgeBase } from "./knowledge.ts";

const source = {
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
        source,
      },
      {
        id: "world:route-102",
        domain: "world",
        title: "Route 102",
        aliases: [],
        tags: ["grass"],
        body: "Ralts can appear here.",
        source,
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
        source,
      },
      {
        id: "items:potion",
        domain: "items",
        title: "Potion",
        aliases: [],
        tags: ["healing"],
        body: "Restores a Pokémon's HP.",
        source,
      },
    ]);

    expect(
      base
        .search("restores pokemon", { domain: "items", limit: 1 })
        .map((result) => result.id),
    ).toEqual(["items:potion"]);
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
    const surfResults = base.search("how to get surf", { limit: 3 });
    expect(
      surfResults.some(
        (result) =>
          result.domain === "progression" &&
          result.excerpt.includes("HM03 (Surf)"),
      ),
    ).toBe(true);
  });
});
