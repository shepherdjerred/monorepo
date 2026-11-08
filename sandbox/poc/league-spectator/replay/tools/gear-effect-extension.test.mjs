import { test, expect } from "bun:test";
import {
  buildGearEffectClosure,
  mergeGearDefinitions,
  gearAssetPath,
} from "./gear-effect-extension.mjs";

const effect = (extra = {}) => ({
  value: { __type: "VfxSystemDefinitionData", ...extra },
  sources: ["data/actor.bin"],
});
const input = (rows = [{ key: 1, value: 2 }], extra = {}) => ({
  actorKey: "champions/example/0",
  gear: { rows },
  resourceKeys: [1],
  objects: new Map([["00000002", effect()]]),
  baseResources: {},
  ...extra,
});
test("original first row including null owns the selected key", () => {
  expect(
    buildGearEffectClosure(
      input([
        { key: 1, value: 0 },
        { key: 1, value: 2 },
      ]),
    ).rows,
  ).toEqual([
    {
      key: 1,
      referenceToken: 0,
      status: "null-object-link",
      definitionId: null,
    },
  ]);
  expect(
    buildGearEffectClosure(
      input([
        { key: 1, value: 2 },
        { key: 1, value: 0 },
      ]),
    ).definitions.size,
  ).toBe(1);
  expect(() => buildGearEffectClosure(input([], {}))).toThrow("absent");
});
test("closure retains source fields/assets and omits unknown older resolver keys", () => {
  const object = effect({
      texture: "ASSETS/Effects/Test.tex",
      child: "{00000003}",
      older: "{00000004}",
      nativeZero: -0,
    }),
    child = effect(),
    result = buildGearEffectClosure(
      input(
        [
          { key: 1, value: 2 },
          { key: 3, value: 5 },
        ],
        {
          objects: new Map([
            ["00000002", object],
            ["00000005", child],
          ]),
          baseResources: { "00000004": {} },
        },
      ),
    );
  expect(result.definitions.size).toBe(2);
  expect(result.definitions.get("00000002").definition).toBe(object.value);
  expect(
    Object.is(result.definitions.get("00000002").definition.nativeZero, -0),
  ).toBe(true);
  expect(result.definitions.get("00000002").dependencies).toEqual([
    { property: ".texture", path: "assets/effects/test.tex" },
  ]);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toContain("older-stack-unrecovered");
});
test("different gear child resolution cannot silently overwrite a canonical definition", () => {
  const objects = new Map([
      ["00000002", effect({ child: "{00000003}" })],
      ["00000005", effect()],
      ["00000006", effect()],
    ]),
    target = new Map();
  mergeGearDefinitions(
    target,
    buildGearEffectClosure(
      input(
        [
          { key: 1, value: 2 },
          { key: 3, value: 5 },
        ],
        { objects },
      ),
    ),
  );
  expect(() =>
    mergeGearDefinitions(
      target,
      buildGearEffectClosure(
        input(
          [
            { key: 1, value: 2 },
            { key: 3, value: 6 },
          ],
          { objects },
        ),
      ),
    ),
  ).toThrow("collision");
  expect(() => buildGearEffectClosure(input([{ key: 1, value: 7 }]))).toThrow(
    "absent",
  );
});
test("selection and asset paths reject unowned namespaces and traversal", () => {
  for (const resourceKeys of [[0], [1, 1], [-1]])
    expect(() =>
      buildGearEffectClosure(input(undefined, { resourceKeys })),
    ).toThrow();
  for (const path of [
    "../bad.tex",
    "/bad.tex",
    "C:/bad.tex",
    "assets//bad.tex",
  ])
    expect(() => gearAssetPath(path)).toThrow();
  expect(gearAssetPath("ASSETS\\Effects\\A.tex")).toBe("assets/effects/a.tex");
});
