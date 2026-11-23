import { expect, test } from "bun:test";
import {
  canonicalDirectSystemObjectPath,
  DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH,
} from "./latest-direct-system-object-path-field.mjs";
import { mapBinHash } from "./tools/map-scene-assets.mjs";
test("known original root HASH projection preserves authored identity for existing validation", () => {
  expect(mapBinHash("objectPath")).toBe(DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH);
  for (const value of ["{883d0c7d}", "{00000000}", null, undefined, 13]) {
    const source = {
        __type: "VfxSystemDefinitionData",
        "{1d369c29}": value,
        other: false,
      },
      projected = canonicalDirectSystemObjectPath(source);
    expect(projected.objectPath).toBe(value);
    expect(projected.other).toBe(false);
    expect(Object.hasOwn(projected, "{1d369c29}")).toBe(false);
    expect(Object.hasOwn(source, "{1d369c29}")).toBe(true);
    expect(() =>
      canonicalDirectSystemObjectPath({ ...source, objectPath: value }),
    ).toThrow("Duplicate original system objectPath field 1d369c29");
  }
  for (const source of [
    { "{1d369c29}": "{883d0c7d}" },
    { __type: "OtherClass", "{1d369c29}": "{883d0c7d}" },
    { __type: "VfxSystemDefinitionData", ObjectPath: "{883d0c7d}" },
  ])
    expect(canonicalDirectSystemObjectPath(source)).toBe(source);
});
