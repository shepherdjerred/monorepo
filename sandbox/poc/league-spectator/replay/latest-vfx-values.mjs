// Authored VFX key values replace the wrapper constant. Probability factors
// multiply the sampled value; supplying a chance does not establish native RNG.
export function createLatestVfxValues(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.float.sampleRva !== 0x16d7de0 ||
    definition.color.sampleRva !== 0x16dc340 ||
    definition.probability.postLoadRva !== 0x1786b10
  )
    throw Error("Unsupported VFX value package");
  const f = Math.fround;
  const finite = (value) => {
    if (!Number.isFinite(value) || !Number.isFinite(f(value)))
      throw Error("Invalid VFX float32 value");
    return f(value);
  };
  function keys(times, values, time) {
    time = finite(time);
    if (
      !Array.isArray(times) ||
      !Array.isArray(values) ||
      times.length !== values.length ||
      !times.length
    )
      throw Error("Invalid VFX curve key lists");
    const t = times.map(finite);
    if (t.some((n, i) => i > 0 && n < t[i - 1]))
      throw Error("Unordered VFX curve keys");
    const vector = Array.isArray(values[0]),
      lanes = vector ? values[0].length : 1;
    const v = values.map((value) => {
      const result = vector ? value : [value];
      if (!Array.isArray(result) || result.length !== lanes)
        throw Error("VFX curve lane disagreement");
      return result.map(finite);
    });
    if (time <= t[0]) return vector ? [...v[0]] : v[0][0];
    let next = 1;
    while (next < t.length && t[next] <= time) next++;
    if (next === t.length) return vector ? [...v.at(-1)] : v.at(-1)[0];
    const share = f(f(time - t[next - 1]) / f(t[next] - t[next - 1]));
    const output = v[next - 1].map((a, lane) =>
      f(a + f(f(v[next][lane] - a) * share)),
    );
    return vector ? output : output[0];
  }
  function probability(table, chance) {
    const times = table.keyTimes ?? [],
      values = table.keyValues ?? [];
    if (times.length !== values.length)
      throw Error("Mismatched VFX probability lists");
    if (!times.length) return finite(table.singleValue ?? 1);
    chance = finite(chance);
    // Native post-load marks precisely two keys at 0 and 1 for an unclamped
    // affine fast path. A non-unit endpoint takes the ordinary key scan.
    if (times.length === 2 && f(times[0]) === 0 && f(times[1]) === 1)
      return f(f(values[0]) + f(chance * f(f(values[1]) - f(values[0]))));
    return keys(times, values, chance);
  }
  function sample(field, time, defaultValue, chances = null) {
    const scalar = !Array.isArray(defaultValue),
      width = scalar ? 1 : defaultValue.length;
    const base = field?.constantValue ?? defaultValue;
    let result = (scalar ? [base] : base).map(finite);
    if (result.length !== width) throw Error("Invalid VFX value width");
    if (field?.dynamics) {
      const { times = [], values = [] } = field.dynamics;
      if (times.length !== values.length)
        throw Error("Mismatched VFX dynamic lists");
      // An explicitly present but empty native dynamic object post-loads to 0.
      const value = times.length
        ? keys(times, values, time)
        : scalar
          ? 0
          : Array(width).fill(0);
      result = scalar ? [value] : value;
      if (result.length !== width)
        throw Error("VFX dynamics width disagreement");
      const tables = field.dynamics.probabilityTables ?? [];
      if (tables.length > width) throw Error("Too many VFX probability lanes");
      for (const [lane, table] of tables.entries()) {
        if (!table) continue;
        const constant = !table.keyTimes?.length;
        if (!constant && (!chances || chances[lane] === undefined))
          throw Error(
            "VFX probability requires a supplied chance; native RNG is unprepared",
          );
        result[lane] = f(
          result[lane] * probability(table, constant ? 0 : chances[lane]),
        );
      }
    }
    return scalar ? result[0] : result;
  }
  return { keys, probability, sample };
}
