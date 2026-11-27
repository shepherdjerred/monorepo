import assert from "node:assert/strict";

const unresolvedControllerIds = [0x6d9e7ec9, 0x76c50391];

export function validateRecordedTerrainVisibility(
  receipt,
  meshes,
  duration,
  { omitUnresolved = false } = {},
) {
  assert.deepEqual(receipt.unboundRecordedNameHashes, []);
  const unresolved = receipt.unresolvedMeshControllerIds;
  if (omitUnresolved) {
    assert.ok(
      Array.isArray(unresolved) &&
        unresolvedControllerIds.every((id) => unresolved.includes(id)),
      "Incomplete unresolved Map11 mesh controller list",
    );
  } else {
    assert.deepEqual(unresolved, unresolvedControllerIds);
  }
  const expectedIds = new Set(
    meshes.map(({ controller }) => controller).filter(Boolean),
  );
  for (const id of unresolved)
    assert.ok(
      expectedIds.delete(id),
      "Unknown unresolved Map11 mesh controller",
    );

  assert.ok(Array.isArray(receipt.tracks));
  const trackedIds = new Set();
  for (const { controllerId, points } of receipt.tracks) {
    assert.ok(
      expectedIds.delete(controllerId),
      "Unexpected Map11 terrain track",
    );
    trackedIds.add(controllerId);
    assert.ok(Array.isArray(points) && points[0]?.[0] === 0);
    let previous = -1;
    for (const point of points) {
      assert.ok(Array.isArray(point) && point.length === 2);
      const [time, visible] = point;
      assert.ok(
        typeof time === "number" && time > previous && time <= duration,
        "Invalid Map11 terrain track clock",
      );
      assert.equal(typeof visible, "boolean");
      previous = time;
    }
  }
  assert.equal(expectedIds.size, 0, "Missing Map11 terrain tracks");
  validateUnresolvedWindows(
    receipt.unresolvedWindows ?? [],
    trackedIds,
    duration,
    omitUnresolved,
  );

  assert.ok(Array.isArray(receipt.ordinaryWrites));
  let previous = 0;
  for (const { nameHash, timeSeconds, visible } of receipt.ordinaryWrites) {
    assert.ok(typeof nameHash === "string" && /^[a-f\d]{8}$/u.test(nameHash));
    assert.ok(
      typeof timeSeconds === "number" &&
        timeSeconds >= previous &&
        timeSeconds <= duration,
      "Invalid Map11 controller write clock",
    );
    assert.equal(typeof visible, "boolean");
    previous = timeSeconds;
  }
  return omitUnresolved ? unresolved : [];
}

function validateUnresolvedWindows(windows, trackedIds, duration, allowed) {
  assert.ok(
    Array.isArray(windows) && (allowed || windows.length === 0),
    "Unresolved terrain windows require explicit private admission",
  );
  const lastEnd = new Map();
  for (const { controllerId, startSeconds, endSeconds } of windows) {
    assert.ok(
      trackedIds.has(controllerId) &&
        Number.isFinite(startSeconds) &&
        Number.isFinite(endSeconds) &&
        startSeconds >= (lastEnd.get(controllerId) ?? 0) &&
        endSeconds > startSeconds &&
        endSeconds <= duration,
      "Invalid unresolved Map11 animation window",
    );
    lastEnd.set(controllerId, endSeconds);
  }
}
