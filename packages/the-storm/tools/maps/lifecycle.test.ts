import { expect, it } from "vitest";
import { verifyBounds, type Lifecycle } from "./lifecycle.ts";

const row = {
  region: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
  blocksSha256: "a".repeat(64),
  decoded: false,
  busy: false,
  ready: false,
  heldChunks: 0,
  preparations: 0,
  releases: 0,
};
const snapshot: Lifecycle = {
  maps: ["one", "two", "three"].map((id) => ({ ...row, id })),
  navigation: [],
  heapUsed: 1,
  heapMax: 2,
  tick: 1,
  tickTimes: [1],
  loadedChunks: {},
};
it("allows one active map and one preparing successor while other metadata stays cold", () => {
  verifyBounds({
    ...snapshot,
    maps: snapshot.maps.map((map, i) => ({
      ...map,
      decoded: i === 0,
      busy: i === 1,
      ready: i === 0,
      heldChunks: i === 0 ? 1 : 0,
    })),
    navigation: ["one"],
  });
});
it("rejects eager loading, stale navigation and ticket leaks", () => {
  expect(() =>
    verifyBounds({
      ...snapshot,
      maps: snapshot.maps.map((map) => ({ ...map, busy: true })),
    }),
  ).toThrow("bound exceeded");
  expect(() => verifyBounds({ ...snapshot, navigation: ["one"] })).toThrow(
    "outside a decoded",
  );
  expect(() =>
    verifyBounds({
      ...snapshot,
      maps: snapshot.maps.map((map, i) => ({
        ...map,
        heldChunks: i === 0 ? 1 : 0,
      })),
    }),
  ).toThrow("retains chunk tickets");
});
