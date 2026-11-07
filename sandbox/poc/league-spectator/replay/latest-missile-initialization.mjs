// Native start-descriptor and packet-position initialization. Caster/bone seeds,
// nonzero local offsets and complete tracked-target/controller state are separate.
export function createLatestMissileInitialization(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.startPlacement?.selectRva !== 0x8658e4 ||
    definition.startPlacement.initializeRva !== 0x874b60 ||
    definition.startPlacement.recordedSourceRva !== 0x874e50 ||
    !Number.isFinite(definition.constants.placementOverrideThreshold.value)
  )
    throw Error("Unsupported missile placement package");
  const f = Math.fround,
    fields = definition.startPlacement.fields,
    threshold = definition.constants.placementOverrideThreshold.value,
    clearance = definition.constants.groundClearance.value;
  if (
    fields.mCastType.offset !== 0x3f0 ||
    fields.mParticleStartOffset.offset !== 0x4b0
  )
    throw Error("Missile placement metadata layout changed");
  function settings(spellData) {
    const castType = Object.hasOwn(spellData, "mCastType")
        ? spellData.mCastType
        : fields.mCastType.default,
      offset = Object.hasOwn(spellData, "mParticleStartOffset")
        ? spellData.mParticleStartOffset
        : fields.mParticleStartOffset.default;
    if (
      !Number.isInteger(castType) ||
      !Array.isArray(offset) ||
      offset.length !== 3 ||
      !offset.every((n) => Number.isFinite(n) && Number.isFinite(f(n)))
    )
      throw Error("Invalid native missile placement settings");
    return { castType, particleStartOffset: offset.map(f) };
  }
  function initializeStart(record, spellData, terrain) {
    const config = settings(spellData),
      cast = record.cast;
    if (
      !Number.isInteger(cast.overrideFlag14d) ||
      cast.overrideFlag14d < 0 ||
      cast.overrideFlag14d > 255 ||
      !Number.isFinite(cast.overrideScalar134) ||
      !Array.isArray(cast.sourcePosition) ||
      cast.sourcePosition.length !== 3 ||
      !cast.sourcePosition.every(
        (n) => Number.isFinite(n) && Number.isFinite(f(n)),
      )
    )
      throw Error("Missing native cast-placement override fields");
    const bypass =
        cast.overrideFlag14d !== 0 && cast.overrideScalar134 > threshold,
      groundRebase = !bypass && [3, 9].includes(config.castType),
      localOffset = groundRebase ? config.particleStartOffset : [0, 0, 0],
      common = {
        settings: config,
        groundRebase,
        overrideBypass: bypass,
        localOffset,
      };
    if (!cast.forceRecordedSourcePosition)
      return {
        ...common,
        status: "unresolved-caster-terrain-bone-seed",
        position: null,
      };
    if (localOffset.some((n) => n !== 0))
      return {
        ...common,
        status: "unresolved-local-start-offset",
        position: null,
      };
    const position = cast.sourcePosition.map(f),
      ground = groundRebase
        ? terrain.sampleHeight(position[0], position[2])
        : null,
      planeHeightOffset = groundRebase
        ? f(position[1] - (ground.inside ? ground.height : 0))
        : 0;
    return {
      ...common,
      status: "initialized",
      position,
      planeHeightOffset,
      attachmentHeightOffset: 0,
      groundHeightStatus: !ground
        ? "not-queried"
        : ground.inside
          ? "navgrid"
          : "outside-navgrid-native-zero",
      scope:
        "Recorded-source start descriptor only; current replication and complete controller/lifetime state are separate",
    };
  }
  function initializeFixedSpeedPacket(
    record,
    movement,
    start,
    target,
    terrain,
  ) {
    if (
      !Number.isFinite(record.elapsedSeconds) ||
      !Number.isFinite(record.movementSpeed) ||
      typeof movement.mUseHeightOffsetAtEnd !== "boolean" ||
      !Number.isFinite(movement.mTargetHeightAugment)
    )
      throw Error("Invalid fixed-speed packet initialization fields");
    if (start.status !== "initialized")
      return { status: start.status, currentPosition: null };
    if (target.status !== "initialized")
      return { status: target.status, currentPosition: null };
    const currentPosition = (
        record.elapsedSeconds > 0 ? record.replicationPosition : start.position
      ).map(f),
      initialPosition = (
        record.elapsedSeconds > 0 ? record.creationPosition : currentPosition
      ).map(f),
      targetPosition = target.position.map(f),
      targetHeightAugment = f(
        record.cast.overrideFlag14d !== 0
          ? record.cast.overrideScalar134
          : movement.mTargetHeightAugment,
      );
    if (movement.mUseHeightOffsetAtEnd) {
      const ground = terrain.sampleHeight(targetPosition[0], targetPosition[2]),
        groundHeight = ground.inside ? ground.height : 0;
      let height = f(
        f(start.planeHeightOffset + groundHeight) + targetHeightAugment,
      );
      // The unbound native flag at spec byte 9 can subtract an attachment-height
      // delta. The admitted recorded-source branch initializes that delta to 0.
      if (start.attachmentHeightOffset !== 0)
        throw Error("Unprepared attachment-height subtraction");
      if (ground.inside && height < groundHeight)
        height = f(groundHeight + clearance);
      targetPosition[1] = height;
    }
    return {
      status: "initialized-position-fields",
      currentPosition,
      initialPosition,
      targetPosition,
      targetHeightAugment,
      movementSpeed: f(record.movementSpeed),
      scope:
        "Native position/height packet fields only; timing, target references, flags, phase execution and full controller playback remain unresolved",
    };
  }
  return { settings, initializeStart, initializeFixedSpeedPacket };
}
