import { describe, expect, test } from "bun:test";
import {
  currentRelationships,
  getPerson,
  getRelationshipHistory,
  getStyleCard,
  listStyleCardNames,
  people,
  relationshipEvents,
  relationshipContextText,
} from "#src/index.ts";

describe("Glitter context", () => {
  test("loads the canonical 13 style cards and resolves aliases", () => {
    expect(listStyleCardNames()).toEqual([
      "aaron",
      "brian",
      "caitlyn",
      "colin",
      "danny",
      "edward",
      "hirza",
      "irfan",
      "jerred",
      "long",
      "richard",
      "ryan",
      "virmel",
    ]);
    expect(getStyleCard("NekoRyan")?.author).toBe("Ryan");
    expect(getStyleCard("gex")?.author).toBe("Aaron");
  });

  test("keeps relationship history while projecting the current graph", () => {
    const history = getRelationshipHistory("caitlyn", "richard");
    expect(history.map((event) => event.label)).toEqual(["Dating", "Exes"]);
    expect(history.map((event) => event.status)).toEqual([
      "historical",
      "current",
    ]);
    expect(
      currentRelationships.find(
        (event) => event.sourceId === "caitlyn" && event.targetId === "richard",
      )?.label,
    ).toBe("Exes");
    expect(relationshipContextText()).toContain("Caitlyn ↔ Richard (Exes)");
  });

  test("all relationship events reference known people", () => {
    const personIds = new Set(people.map((person) => person.id));
    for (const event of relationshipEvents) {
      expect(personIds.has(event.sourceId)).toBe(true);
      expect(personIds.has(event.targetId)).toBe(true);
    }
    expect(getPerson("NekoRyan")?.id).toBe("ryan");
  });
});
