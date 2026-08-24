import { describe, expect, test } from "vitest";
import {
  currentRelationships,
  getRelationshipHistory,
  people,
} from "@shepherdjerred/glitter-context";
import { assignParallelOffsets } from "../public/link-layout.js";

describe("Glitter relationship graph data", () => {
  test("renders only the current Caitlyn and Richard relationship", () => {
    const history = getRelationshipHistory("caitlyn", "richard");
    expect(history.map((event) => event.label)).toEqual(["Dating", "Exes"]);
    expect(
      currentRelationships.filter(
        (event) => event.sourceId === "caitlyn" && event.targetId === "richard",
      ),
    ).toHaveLength(1);
    expect(
      currentRelationships.find(
        (event) => event.sourceId === "caitlyn" && event.targetId === "richard",
      )?.label,
    ).toBe("Exes");
  });

  test("keeps isolated people in the static graph context", () => {
    expect(people.map((person) => person.id)).toEqual(
      expect.arrayContaining(["nicole", "sean", "wanye"]),
    );
  });

  test("separates parallel links with opposite directions", () => {
    const links = [
      { source: "danny", target: "hannah", parallelOffset: 0 },
      { source: "hannah", target: "danny", parallelOffset: 0 },
    ];

    assignParallelOffsets(links);

    expect(links.map((link) => link.parallelOffset)).toEqual([-0.5, -0.5]);
  });
});
