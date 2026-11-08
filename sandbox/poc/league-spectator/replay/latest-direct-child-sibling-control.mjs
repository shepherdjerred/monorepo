// Diagnostic comparison only. This does not authorize a child scheduler or
// declare every installed child-bearing definition independent.
function fail(message) {
  throw new Error(`Malformed native child sibling control: ${message}`);
}
function actor(frame, index) {
  const matches = frame.state.actors.filter(
    (value) => value.emitterIndex === index,
  );
  if (matches.length !== 1 || matches[0].kind !== "complex")
    fail("sibling actor identity");
  return matches[0];
}
function draw(frame, index) {
  const matches = frame.siblingDraws.filter(
    (value) => value.emitterIndex === index,
  );
  if (matches.length !== 1) fail("sibling draw identity");
  return matches[0];
}
function hex(value, bytes = null) {
  return (
    typeof value === "string" &&
    /^(?:[0-9a-f]{2})*$/.test(value) &&
    (bytes === null || value.length === bytes * 2)
  );
}
export function compareDirectChildSiblingControls(authored, typedNull) {
  for (const [control, variant] of [
    [authored, "authored"],
    [typedNull, "typed-child-null"],
  ]) {
    if (
      control?.kind !== "original-child-free-sibling-independence-control" ||
      control.variant !== variant ||
      control.completed !== true ||
      control.boundary !== null ||
      control.requestedFrames !== 61 ||
      control.frames?.length !== 61 ||
      !Array.isArray(control.siblingIndices) ||
      control.siblingIndices.length === 0 ||
      new Set(control.siblingIndices).size !== control.siblingIndices.length ||
      control.siblingIndices.some(
        (index) => !Number.isInteger(index) || index < 0,
      ) ||
      control.scope?.childGlobalSchedulerActivationRecovered !== false ||
      control.scope.parentSchedulerOrRngReplaced !== false
    )
      fail("scope or complete schedule");
  }
  if (
    authored.effectId !== typedNull.effectId ||
    authored.build !== typedNull.build ||
    authored.protocol !== typedNull.protocol ||
    JSON.stringify(authored.siblingIndices) !==
      JSON.stringify(typedNull.siblingIndices)
  )
    fail("paired identity");
  if (
    !authored.lookupSuccesses.length ||
    typedNull.lookupSuccesses.length ||
    authored.factories.length <= 1 ||
    typedNull.factories.length !== 1 ||
    !typedNull.details.typedChildControls?.length
  )
    fail("positive authored versus typed-null branch");
  const differences = [];
  const counts = {
    frames: 61,
    siblingFrames: 0,
    poolVectors: 0,
    poolBytes: 0,
    particleSamples: 0,
    geometryBytes: 0,
    positiveGeometryFrames: 0,
    globalRngFrames: 0,
  };
  const compare = (left, right, path) => {
    if (left !== right) differences.push(path);
  };
  for (let frameIndex = 0; frameIndex < 61; frameIndex++) {
    const left = authored.frames[frameIndex],
      right = typedNull.frames[frameIndex];
    if (
      !Number.isFinite(left.time) ||
      !Number.isFinite(right.time) ||
      !hex(left.state.rngHex, 12) ||
      !hex(right.state.rngHex, 12)
    )
      fail("clock or RNG");
    compare(left.time, right.time, `${frameIndex}:time`);
    compare(left.state.rngHex, right.state.rngHex, `${frameIndex}:globalRng`);
    counts.globalRngFrames++;
    for (const index of authored.siblingIndices) {
      const a = actor(left, index),
        b = actor(right, index);
      const names = Object.keys(a.vectors).sort();
      if (
        !names.length ||
        JSON.stringify(names) !== JSON.stringify(Object.keys(b.vectors).sort())
      )
        fail("pool vector identity");
      for (const name of names) {
        const av = a.vectors[name],
          bv = b.vectors[name];
        if (
          !Number.isInteger(av.count) ||
          av.count < 0 ||
          !hex(av.bytesHex) ||
          !hex(bv.bytesHex)
        )
          fail("pool vector");
        compare(av.count, bv.count, `${frameIndex}:${index}:${name}:count`);
        compare(
          av.bytesHex,
          bv.bytesHex,
          `${frameIndex}:${index}:${name}:bytes`,
        );
        counts.poolVectors++;
        counts.poolBytes += av.bytesHex.length / 2;
      }
      const ad = draw(left, index),
        bd = draw(right, index);
      if (
        !hex(ad.verticesHex) ||
        !hex(ad.indicesHex) ||
        !hex(bd.verticesHex) ||
        !hex(bd.indicesHex)
      )
        fail("geometry bytes");
      compare(ad.kind, bd.kind, `${frameIndex}:${index}:primitive`);
      compare(
        ad.particleCount,
        bd.particleCount,
        `${frameIndex}:${index}:particles`,
      );
      compare(
        ad.verticesHex,
        bd.verticesHex,
        `${frameIndex}:${index}:vertices`,
      );
      compare(ad.indicesHex, bd.indicesHex, `${frameIndex}:${index}:indices`);
      counts.geometryBytes +=
        (ad.verticesHex.length + ad.indicesHex.length) / 2;
      counts.particleSamples += ad.particleCount;
      counts.positiveGeometryFrames += Number(
        ad.verticesHex.length > 0 && ad.indicesHex.length > 0,
      );
      counts.siblingFrames++;
    }
  }
  if (!counts.particleSamples || !counts.positiveGeometryFrames)
    fail("vacuous no-particle control");
  return {
    effectId: authored.effectId,
    siblingIndices: [...authored.siblingIndices],
    counts,
    matched: differences.length === 0,
    differences,
    scope: {
      onlyObservedInstalledSiblings: true,
      childActivationProven: false,
      globalChildSchedulerProven: false,
      nativeReplayAcceptance: null,
      productionAdmissionChanged: false,
    },
  };
}
