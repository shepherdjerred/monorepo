import { describe, expect, test } from "bun:test";
import {
  compileOriginalFxInventory,
  originalFxReferences,
  originalFxPath,
} from "./archived-fx-inventory.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";

describe("original archived FX inventory", () => {
  test("long serialized WAD namespace names remain bounded and never become host paths", () => {
    const name = `DATA/Characters/Ahri/${"Skin15_".repeat(200)}.bin`;
    expect(originalFxPath(name)).toBe(name.toLowerCase());
    expect(() => originalFxPath(`data/${"x".repeat(4096)}.bin`)).toThrow(
      "Bounded",
    );
    expect(() => originalFxPath("data/../secret.bin")).toThrow("Bounded");
  });
  test("retains both original map rows and exact typed asset references", () => {
    const node = {
      fields: {
        a: {
          type: "Map",
          entries: [
            {
              key: { type: "Hash", value: 7 },
              value: { type: "WadChunkLink", value: "18446744073709551615" },
            },
            {
              key: { type: "Hash", value: 7 },
              value: { type: "String", value: "Assets/Particles/a.tex" },
            },
          ],
        },
      },
    };
    const rows = originalFxReferences(node);
    expect(rows.map((row) => row.value)).toEqual([
      "00000007",
      "18446744073709551615",
      "00000007",
      "assets/particles/a.tex",
    ]);
    expect(rows[1].trail).toEqual(["fields", "a", "entries", 0, "value"]);
    expect(rows[3].trail).toEqual(["fields", "a", "entries", 1, "value"]);
  });
  test("rejects out-of-width hashes and path traversal", () => {
    expect(() =>
      originalFxReferences({
        fields: { a: { type: "WadChunkLink", value: "18446744073709551616" } },
      }),
    ).toThrow("width");
    expect(() =>
      originalFxReferences({
        fields: { a: { type: "String", value: "assets/../secret.tex" } },
      }),
    ).toThrow("traversal");
  });
  test("inventories every definition and preserves conflicts without choosing a winner", () => {
    const node = {
        pathHash: "00000001",
        classHash: mapBinHash("VfxSystemDefinitionData"),
        fields: {},
      },
      make = (file, object) => ({
        file,
        wad: "Map11",
        tree: {
          build: "16.21.829.8620",
          reader: "scout-exact-property-bin-16.21",
          sourceSha256: file,
          objects: [object],
        },
      }),
      inventory = compileOriginalFxInventory([
        make("a", node),
        make("b", { ...node, fields: { x: { type: "Float", value: 1 } } }),
      ]);
    expect(inventory.effects).toHaveLength(2);
    expect(inventory.objects).toHaveLength(2);
    expect(inventory.conflicts).toHaveLength(1);
    expect(
      inventory.conflicts[0].candidates.map((value) => value.file),
    ).toEqual(["a", "b"]);
  });
});
