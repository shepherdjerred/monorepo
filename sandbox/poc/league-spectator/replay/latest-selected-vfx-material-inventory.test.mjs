import { expect, test } from "bun:test";
import {
  createSelectedNativeMaterialInventory,
  selectedNativeMaterialEmitterCount,
} from "./latest-selected-vfx-material-inventory.mjs";
test("a metadata lookalike cannot select a different native material corpus", () => {
  for (const token of [
    null,
    {},
    Object.freeze({
      policy: "selected-complete-native-quad-material-inventory-v1",
      emitters: 2218,
    }),
  ])
    expect(() =>
      selectedNativeMaterialEmitterCount(token, {
        materialSha256: "a".repeat(64),
        profile: {},
      }),
    ).toThrow("Owned exact");
});
test("a caller-supplied reference cannot replace the fixed native algorithm approval", async () => {
  let loaded = false;
  await expect(
    createSelectedNativeMaterialInventory({
      approvedReferenceBytes: new Uint8Array([1]),
      materialBytes: new Uint8Array([1]),
      boundQuadBytes: new Uint8Array([1]),
      imageBytes: new Uint8Array([1]),
      profile: {},
      loadGraph() {
        loaded = true;
        return new Uint8Array();
      },
    }),
  ).rejects.toThrow("Fixed original");
  expect(loaded).toBe(false);
});
