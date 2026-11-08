const poses = {
  identity: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  yaw90: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  pitch90: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
};
const equal = (a, b) => {
  if (
    a === null ||
    typeof a !== "object" ||
    b === null ||
    typeof b !== "object"
  )
    return Object.is(a, b);
  const keys = Object.keys(a);
  return (
    Array.isArray(a) === Array.isArray(b) &&
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
};
const motion = (time) => [time * 130, time * 3, time * 70];
// Selection provenance is independent of the exact original graphs/numeric
// inputs. Admission changes may not shrink a previously observed case cohort.
export function validateDirectGroundCohort({
  cases,
  expectedIds,
  currentIds,
  templates,
  definitionHashes,
}) {
  const expected = [...new Set(expectedIds)].sort(),
    current = [...new Set(currentIds)].sort(),
    observed = [
      ...new Set(cases.map((row) => `${row.effectId}:${row.emitterIndex}`)),
    ].sort();
  if (
    !equal(current, expected) ||
    !equal(observed, expected) ||
    cases.length !== expected.length * 6
  )
    throw Error("Complete fixed ground component/case inventory required");
  const keys = new Set();
  for (const row of cases) {
    const id = `${row.effectId}:${row.emitterIndex}`,
      template = templates.get(id),
      key = `${id}:${row.seedHex}:${row.pose}`;
    if (
      !template ||
      keys.has(key) ||
      !Object.hasOwn(poses, row.pose) ||
      !["0000000000000001", "0000000000012345"].includes(row.seedHex) ||
      row.frames.length !== 121
    )
      throw Error("Exact unique ground seed/pose/clock cases required");
    keys.add(key);
    if (
      row.primitiveKind !== template.kind ||
      row.graphSha256 !== template.sha256 ||
      definitionHashes.get(row.effectId) !== template.sourceDefinitionSha256
    )
      throw Error("Exact original ground definition/graph identity required");
    for (let tick = 0; tick < 121; tick++) {
      const time = tick / 60,
        input = {
          time,
          previous: tick ? motion((tick - 1) / 60) : [0, 0, 0],
          current: motion(time),
          basis: poses[row.pose],
          viewPosition: [0, 0, 1000],
          cameraRight: [1, 0, 0],
          cameraUp: [0, 1, 0],
          viewAxis: [0, 0, 1],
        };
      if (!equal(row.frames[tick].input, input))
        throw Error("Exact original ground clock/motion/basis inputs required");
    }
  }
  return {
    components: expected.length,
    cases: cases.length,
    frames: cases.length * 121,
  };
}
