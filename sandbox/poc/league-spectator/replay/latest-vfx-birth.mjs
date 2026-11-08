// These native kernels require an explicit random seed. A reproducible supplied
// seed is not evidence for the original match's seed or thread/call ordering.
export function createLatestVfxBirth(definition, values) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.random.nextFloatRva !== 0x1490eb0 ||
    definition.random.wordRva !== 0x2e7b70 ||
    definition.random.seedRva !== 0x14910e0 ||
    definition.random.wordMultiplierHex !== "2545f4914f6cdd1d" ||
    definition.random.floatScaleBits !== 0x2f800000 ||
    definition.point.classHash !== "ee39916f" ||
    definition.point.sampleRva !== 0x170acb0 ||
    definition.randomizedValues[2].sampleRva !== 0x16d8d40 ||
    definition.randomizedValues[3].sampleRva !== 0x16d9fa0 ||
    definition.randomizedValues[4].sampleRva !== 0x16db8d0 ||
    typeof values?.sample !== "function"
  )
    throw Error("Unsupported VFX birth package");
  const mask = 0xffffffffffffffffn,
    multiplier = 0x2545f4914f6cdd1dn,
    f = Math.fround;
  function uint64(value) {
    if (typeof value !== "bigint" || value < 0n || value > mask)
      throw Error("VFX seed/state must be an explicit uint64 BigInt");
    return value;
  }
  function floatFromLowWord(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw Error("Invalid VFX random word");
    // Native special-cases precisely UINT32_MAX; other high words can round to
    // 1.0 during float32 conversion before multiplication by 2^-32.
    return f(f(value === 0xffffffff ? 0 : value) * 2 ** -32);
  }
  function createRandom(seed) {
    let state, draws;
    function reset(value) {
      state = uint64(value);
      if (state === 0n) state = 1n;
      draws = 0;
    }
    reset(seed);
    return {
      next() {
        state ^= state >> 12n;
        state = (state ^ (state << 25n)) & mask;
        state ^= state >> 27n;
        const word = (state * multiplier) & mask;
        draws = (draws + 1) >>> 0;
        return floatFromLowWord(Number(word & 0xffffffffn));
      },
      reset,
      snapshot() {
        return { stateHex: state.toString(16).padStart(16, "0"), draws };
      },
      restore(snapshot) {
        if (
          !snapshot ||
          !/^[0-9a-f]{16}$/.test(snapshot.stateHex) ||
          !Number.isInteger(snapshot.draws) ||
          snapshot.draws < 0 ||
          snapshot.draws > 0xffffffff
        )
          throw Error("Invalid VFX random checkpoint");
        const restored = uint64(BigInt(`0x${snapshot.stateHex}`));
        if (restored === 0n) throw Error("Invalid zero VFX random state");
        state = restored;
        draws = snapshot.draws;
      },
    };
  }
  function pointOffset(shape) {
    if (
      shape?.__type !== "{ee39916f}" ||
      Object.keys(shape).some((k) => !["__type", "emitOffset"].includes(k))
    )
      throw Error("Unprepared point spawn shape");
    const value = shape.emitOffset ?? [0, 0, 0];
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((n) => !Number.isFinite(n) || !Number.isFinite(f(n)))
    )
      throw Error("Invalid point spawn offset");
    return value.map(f);
  }
  function sampleValue(field, time, defaultValue, random, sharedChance = null) {
    const tables = field?.dynamics?.probabilityTables ?? [],
      width = Array.isArray(defaultValue) ? defaultValue.length : 1;
    const families = {
        1: ["ValueFloat", "VfxAnimatedFloatVariableData"],
        2: ["ValueVector2", "VfxAnimatedVector2fVariableData"],
        3: ["ValueVector3", "VfxAnimatedVector3fVariableData"],
        4: ["ValueColor", "VfxAnimatedColorVariableData"],
      },
      family = families[width];
    if (
      !family ||
      (field && field.__type !== family[0]) ||
      (field?.dynamics && field.dynamics.__type !== family[1]) ||
      Object.keys(field ?? {}).some(
        (key) => !["__type", "constantValue", "dynamics"].includes(key),
      ) ||
      Object.keys(field?.dynamics ?? {}).some(
        (key) =>
          !["__type", "times", "values", "probabilityTables"].includes(key),
      )
    )
      throw Error("Unprepared VFX value family or evaluation mode");
    if (
      tables.length &&
      (tables.length !== width || tables.some((table) => !table))
    )
      throw Error("Unprepared sparse probability-table layout");
    if (
      sharedChance !== null &&
      (!Number.isFinite(sharedChance) || !Number.isFinite(f(sharedChance)))
    )
      throw Error("Invalid shared VFX random chance");
    const chances = tables.map((table) => {
      if (!table.keyTimes?.length) return 0;
      if (sharedChance !== null) return f(sharedChance);
      if (typeof random?.next !== "function")
        throw Error(
          "Randomized VFX value requires an explicit stream or shared chance",
        );
      return random.next();
    });
    return values.sample(field, time, defaultValue, chances);
  }
  return { createRandom, floatFromLowWord, pointOffset, sampleValue };
}
