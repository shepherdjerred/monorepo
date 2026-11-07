import { expect, test } from "bun:test";
import {
  createLatestMissileTracking,
  MISSILE_TRACKING_OMISSIONS,
} from "./latest-missile-tracking.mjs";
const contract = {
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  targetQueryRva: 0x88b5e0,
  controllerQueryRva: 0x88b500,
  controllerFrameRva: 0x88b760,
};
const target = (overrides = {}) => ({
  kind: "supplied-ai-query-view",
  internalId: 0x10001,
  position: [1000, 20, 0],
  aimOffset: [2, 3, 4],
  radius: 0,
  visible: true,
  ...overrides,
});
const init = (api, overrides = {}) =>
  api.initialize({
    tracksTarget: true,
    tracksHidden: false,
    acceptedInternalId: 0x10001,
    endpoint: [900, 10, 0],
    heightAugment: 7.5,
    target: target(),
    modeValue: 0,
    ...overrides,
  });

test("initial query accepts supplied hidden targets; ordinary frames retain last accepted target", () => {
  const api = createLatestMissileTracking(contract);
  const state = init(api, { target: target({ visible: false }) });
  expect(state.targetPosition).toEqual([1000, 27.5, 0]);
  expect(state.aimOffset).toEqual([2, 3, 4]);
  const initial = structuredClone(state);
  expect(
    api.update(state, target({ visible: false, position: [1100, 30, 4] }), 0)
      .reason,
  ).toBe("target:visibility-query-rejected");
  expect(state.targetPosition).toEqual(initial.targetPosition);
  expect(api.update(state, null, 0).reason).toBe(
    "target:internal-reference-unaccepted",
  );
  expect(api.update(state, target({ internalId: 0x20001 }), 0).resolved).toBe(
    false,
  );
  expect(state.targetPosition).toEqual(initial.targetPosition);
  api.update(state, target({ position: [1200, 40, 7] }), 0);
  expect(state.targetPosition).toEqual([1200, 47.5, 7]);
});

test("tracking settings and explicit native mode inputs preserve their distinct gates", () => {
  const api = createLatestMissileTracking(contract);
  const disabled = init(api, { tracksTarget: false });
  expect(disabled.targetPosition).toEqual([900, 10, 0]);
  api.update(disabled, target(), 1);
  expect(disabled.targetPosition).toEqual([900, 10, 0]);
  for (const options of [
    { tracksHidden: true, mode: 0 },
    { tracksHidden: false, mode: 1 },
    { tracksHidden: false, mode: 0xffffffff },
  ]) {
    const state = init(api, options);
    expect(
      api.update(
        state,
        target({ visible: false, position: [4, 5, 6] }),
        options.mode,
      ).resolved,
    ).toBe(true);
    expect(state.targetPosition).toEqual([4, 12.5, 6]);
  }
});

test("unverified bones and malformed world views cannot become accepted targets", () => {
  const api = createLatestMissileTracking(contract);
  const state = init(api, { boneHash: 42 });
  expect(state.targetPosition).toEqual([900, 10, 0]);
  expect(state.lastQuery).toBe("target:bone-query-unimplemented");
  for (const bad of [
    target({ internalId: -1 }),
    target({ visible: null }),
    target({ kind: "guessed-world-position" }),
    target({ position: [0, Infinity, 0] }),
  ])
    expect(() => api.update(state, bad, 0)).toThrow(
      "Explicit accepted internal AI target view required",
    );
  for (const mode of [-1, "0", null, 2 ** 32])
    expect(() => api.update(state, target(), mode)).toThrow(
      "Explicit bounded missile target-query inputs required",
    );
  expect(api.actualMatchAdmitted).toBe(false);
  expect(api.omissions).toEqual(MISSILE_TRACKING_OMISSIONS);
  expect(() =>
    createLatestMissileTracking({ ...contract, build: "other" }),
  ).toThrow();
});
