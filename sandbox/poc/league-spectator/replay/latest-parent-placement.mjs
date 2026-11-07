// Original exact-build object setters and provider-free propagation.
// Supplied world inputs; replay/entity/bone resolution belongs to their producer.
export const PARENT_POSE_INPUT = 0x100e5000;
const SETTERS = {
  initialPosition: 0x17671b0,
  position: 0x1755d10,
  secondaryPosition: 0x1767180,
  basis: 0x1755d40,
  direction: 0x1767230,
};
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
export function applyParentPlacement(
  k,
  object,
  pose,
  { initial = false, captureState = true } = {},
) {
  if (k.nativeRunning || k.allocations.get(object) !== 0x238)
    throw Error("Placement requires an idle owned object");
  const keys =
    pose && typeof pose === "object" && !Array.isArray(pose)
      ? Object.keys(pose)
      : [];
  if (
    !keys.length ||
    keys.some(
      (key) =>
        !["position", "secondaryPosition", "basis", "direction"].includes(key),
    )
  )
    throw Error("Unknown or empty parent placement fields");
  if (Object.hasOwn(pose, "basis") && Object.hasOwn(pose, "direction"))
    throw Error("Placement cannot supply both basis and direction");
  if (typeof initial !== "boolean" || typeof captureState !== "boolean")
    throw Error("Explicit parent placement modes required");
  for (const key of keys) {
    const value = pose[key];
    if (
      !Array.isArray(value) ||
      value.length !== (key === "basis" ? 16 : 3) ||
      value.some(
        (v) =>
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          !Number.isFinite(Math.fround(v)),
      )
    )
      throw Error("Placement requires finite native float vectors");
  }
  if (
    pose.direction &&
    !(
      pose.direction.reduce((s, v) => s + Math.fround(v) * Math.fround(v), 0) >
      0
    )
  )
    throw Error("Placement requires a nonzero direction");
  if (
    pose.basis &&
    [3, 7, 11, 15].some((at, i) => pose.basis[at] !== [0, 0, 0, 1][i])
  )
    throw Error("Placement requires an affine basis");
  const calls = [];
  for (const key of ["position", "secondaryPosition", "basis", "direction"]) {
    if (!Object.hasOwn(pose, key)) continue;
    k.put(PARENT_POSE_INPUT, pose[key]);
    const setter =
      SETTERS[initial && key === "position" ? "initialPosition" : key];
    k.callNative(setter, { RDI: object, RSI: PARENT_POSE_INPUT });
    calls.push(setter);
  }
  return {
    setters: calls,
    ...(captureState ? { objectHex: hex(k.read(object, 0x238)) } : {}),
  };
}
export function synchronizeParentPlacement(
  k,
  object,
  { captureState = true } = {},
) {
  if (k.nativeRunning || k.allocations.get(object) !== 0x238)
    throw Error("Placement sync requires an idle owned object");
  const parent = k.q(object + 0x28);
  if (k.allocations.get(parent) !== 0x2c0)
    throw Error("Placement sync requires a live owned parent");
  if ([0x170, 0x180, 0x190].some((off) => k.q(object + off)))
    throw Error("Live transform providers require another placement contract");
  if (new DataView(k.read(object + 0x1f0, 4).buffer).getFloat32(0, true) !== 0)
    throw Error("Object-owned simulation time requires a real frame input");
  if (typeof captureState !== "boolean")
    throw Error("Explicit parent placement capture mode required");
  k.placementSyncActive = true;
  try {
    k.callNative(0x1765a50, { RDI: object, RSI: 0, RDX: 0 });
  } finally {
    k.placementSyncActive = false;
  }
  return captureState
    ? {
        objectHex: hex(k.read(object, 0x238)),
        parentHex: hex(k.read(parent, 0x2c0)),
      }
    : {};
}
