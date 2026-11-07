// Exact-build count kernel; it does not choose the client's frame schedule,
// quality level, emitter activation gates or primitive-specific trail capacity.
export function createLatestVfxEmission(definition, values) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.countRva !== 0x1758680 ||
    definition.primitiveCapacityRva !== 0x176db00 ||
    definition.perUpdateCapSecondsBits !== 0x3ea8f5c3 ||
    definition.maximumBirthsPerUpdate !== 1000 ||
    definition.defaults.periodBits !== 0x7f7fffff ||
    definition.defaults.rate !== 0 ||
    definition.defaults.lastEmissionTime !== 0
  )
    throw Error("Unsupported VFX emission package");
  const f = Math.fround,
    floatBits = (bits) => new Float32Array(new Uint32Array([bits]).buffer)[0],
    periodDefault = floatBits(definition.defaults.periodBits),
    capSeconds = floatBits(definition.perUpdateCapSecondsBits),
    finite = (n) => {
      if (!Number.isFinite(n) || !Number.isFinite(f(n)))
        throw Error("Invalid VFX emission input");
      return f(n);
    },
    // SSE cvttss2si returns the integer-indefinite bit pattern on overflow/NaN.
    cvtt = (n) =>
      !Number.isFinite(n) || n >= 2147483648 || n < -2147483648
        ? -2147483648
        : Math.trunc(n),
    maxss = (a, b) =>
      Number.isNaN(a) || Number.isNaN(b) || a === b ? b : Math.max(a, b);
  function eligibility(emitter) {
    const reasons = [];
    if (emitter.rate && emitter.rate.__type !== "ValueFloat")
      reasons.push("rate-value-type");
    if (
      emitter.rate?.dynamics &&
      emitter.rate.dynamics.__type !== "VfxAnimatedFloatVariableData"
    )
      reasons.push("rate-dynamics-type");
    if (
      Object.keys(emitter.rate?.dynamics ?? {}).some(
        (key) =>
          !["__type", "times", "values", "probabilityTables"].includes(key),
      )
    )
      reasons.push("unprepared-rate-dynamics-field");
    if (emitter.flexRate) reasons.push("flex-rate");
    if (emitter.rateByVelocityFunction) reasons.push("velocity-derived-rate");
    if (
      emitter.rate?.dynamics?.probabilityTables?.some(
        (t) => t?.keyTimes?.length,
      )
    )
      reasons.push("rate-rng");
    if (
      emitter.rate?.dynamics?.isSampled ||
      emitter.rate?.dynamics?.bakedValues
    )
      reasons.push("baked-rate");
    return { supported: !reasons.length, reasons };
  }
  function count(emitter, input) {
    const admission = eligibility(emitter);
    if (!admission.supported)
      throw Error(`Unprepared VFX emission: ${admission.reasons.join(", ")}`);
    if (typeof input.hasEmitted !== "boolean")
      throw Error("Invalid VFX birth state");
    const time = finite(input.time),
      age = finite(input.normalizedAge),
      last = finite(input.lastEmissionTime),
      quality = finite(input.qualityScale),
      period = finite(emitter.period ?? periodDefault),
      sampledRate = values.sample(emitter.rate, age, definition.defaults.rate),
      rate = maxss(f(sampledRate * quality), 0),
      periodStart = f(f(cvtt(f(time / period))) * period),
      since = f(time - maxss(periodStart, last)),
      requested = cvtt(f(since * rate)),
      ceiling = (cvtt(f(capSeconds * rate)) + 1) | 0;
    let result =
      (ceiling & 0xffff) >= (requested & 0xffff) ? requested : ceiling;
    if (!input.hasEmitted) {
      if ((result & 0xffff) === 0)
        result = emitter.HasVariableStartTime ? 0 : 1;
      if (emitter.isSingleParticle) {
        result = cvtt(rate);
        if ((result & 0xffff) < 1) result = (result + 1) | 0;
      }
    }
    return {
      count: result & 0xffff,
      rate,
      periodStart,
      sinceLastEmission: since,
    };
  }
  // The original birth path writes the current time and sets bit 4. Calling
  // this assumes birth execution was admitted; count alone does not prove that.
  function commitBirth(state, time) {
    state.lastEmissionTime = finite(time);
    state.hasEmitted = true;
  }
  function birthOrigins(previous, current, requestedCount) {
    if (
      !Number.isInteger(requestedCount) ||
      requestedCount < 0 ||
      requestedCount > 0xffff ||
      !Array.isArray(previous) ||
      previous.length !== 3 ||
      !Array.isArray(current) ||
      current.length !== 3
    )
      throw Error("Invalid VFX birth-origin input");
    const a = previous.map(finite),
      b = current.map(finite),
      count = Math.min(requestedCount, definition.maximumBirthsPerUpdate),
      delta = b.map((n, i) => f(n - a[i]));
    return Array.from({ length: count }, (_, index) => {
      const share = f(f(index + 1) / f(count));
      return a.map((n, lane) => f(n + f(delta[lane] * share)));
    });
  }
  return { eligibility, count, commitBirth, birthOrigins };
}
