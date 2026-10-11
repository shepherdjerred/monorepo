import { expect, it } from "vitest";
import { repairMetadata } from "./repairs.ts";
import { legacyMap } from "./legacy.ts";

const text = `Name: Damaged
Author: Builders
Description: Three bombs
Border: ['-10,0,-10','10,0,10']
Teams:
  RED: {Spawns: ['-5,2,0']}
  BLUE: {Spawns: ['5,2,0']}
Custom:
  RED Bombs: [null]
  BLUE Bombs: ['5,2,0']
`;
const repair = {
  schema: 1,
  maps: [
    {
      id: "damaged",
      archiveSha256: "a".repeat(64),
      reason: "Existing source TNT",
      bombs: { RED: [[-5, 2, 0]] },
    },
  ],
};

it("repairs checksum-bound missing metadata without changing the source text", () => {
  const result = repairMetadata(text, "damaged", "a".repeat(64), repair);
  expect(legacyMap(result.text).teams[0]?.bombs).toEqual([[-5, 2, 0]]);
  expect(result.repair).toEqual(repair.maps[0]);
  expect(text).toContain("RED Bombs: [null]");
});
it("rejects a different archive and replacement of existing objectives", () => {
  expect(() => repairMetadata(text, "damaged", "b".repeat(64), repair)).toThrow(
    "another original",
  );
  expect(() =>
    repairMetadata(
      text.replace("[null]", "['-5,2,0']"),
      "damaged",
      "a".repeat(64),
      repair,
    ),
  ).toThrow("existing");
});
