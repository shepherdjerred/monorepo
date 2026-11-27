import { expect, test } from "bun:test";
import { selectChampionAnimations } from "./native-terrain-animation-model-selector.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const exact = {
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
};
const asset = (digest, extension) =>
  `/champion-animations/${digest.repeat(64)}.${extension}`;
const model = (digit) => `/champion-models/${digit.repeat(64)}.glb`;
const action = {
  name: "Run",
  durationSeconds: 1.2,
  rig: asset("a", "skl"),
  clip: asset("b", "clip"),
  bindings: asset("c", "json"),
};
const championModels = {
  bindings: Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    url: model(String(index)),
  })),
};
const catalog = {
  ...exact,
  models: [
    { model: model("2"), actions: [action] },
    { model: model("a"), actions: [action] },
  ],
};

test("uses only exact selected assets and records unsupported actor identities", () => {
  const { actors, omissions } = selectChampionAnimations(
    exact,
    catalog,
    championModels,
  );
  const { name, ...resources } = action;
  expect([...actors]).toEqual([
    [3, { model: model("2"), actions: new Map([[name, resources]]) }],
  ]);
  expect(omissions).toEqual({ missingModel: [1, 2, 4, 5, 6, 7, 8, 9, 10] });
  expect(
    selectChampionAnimations(
      exact,
      { ...catalog, models: [catalog.models[1]] },
      championModels,
    ).actors.size,
  ).toBe(0);
});

test("rejects foreign, replay-bound, duplicate, or mixed-rig animation data", () => {
  expect(() =>
    selectChampionAnimations(
      { ...exact, protocol: "foreign" },
      catalog,
      championModels,
    ),
  ).toThrow("require exact selected models");
  expect(() =>
    selectChampionAnimations(
      exact,
      { ...catalog, replaySha256: "fixture" },
      championModels,
    ),
  ).toThrow("require exact selected models");
  expect(() =>
    selectChampionAnimations(
      exact,
      { ...catalog, models: [catalog.models[0], catalog.models[0]] },
      championModels,
    ),
  ).toThrow("must be distinct");
  expect(() =>
    selectChampionAnimations(
      exact,
      {
        ...catalog,
        models: [
          {
            ...catalog.models[0],
            actions: [
              action,
              { ...action, name: "Walk", rig: asset("d", "skl") },
            ],
          },
        ],
      },
      championModels,
    ),
  ).toThrow("Invalid authored champion animation action");
});
