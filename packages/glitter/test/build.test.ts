import { describe, expect, test } from "bun:test";
import {
  currentRelationships,
  getRelationshipHistory,
} from "@shepherdjerred/glitter-context";

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
});
