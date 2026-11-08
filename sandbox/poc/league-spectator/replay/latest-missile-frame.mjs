// Exact-build controller frames on owned no-target snapshots. Clock values are
// explicit inputs; this does not invent the game's frame schedule or implement
// actor collision, phase dispatch, lifetime or presentation.
export function createLatestMissileFrame(
  definition,
  motion,
  controllers,
  terrain,
) {
  const frame = definition.frame,
    f = Math.fround;
  if (
    definition.build !== "16.21.829.8620" ||
    frame.stepRva !== 0x88b760 ||
    frame.buildUpdateRva !== 0x88d350 ||
    frame.applyRva !== 0x88a590 ||
    frame.runtimeDefaults.canPassOnce !== 0 ||
    definition.verticalFacing.VerticalFacingFaceTarget.evaluateRva !== 0x8908c0
  )
    throw Error("Unsupported missile frame package");
  const bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0];
  function eligibility(record) {
    const reasons = [];
    if (record.movementType !== "FixedSpeedMovement")
      reasons.push("movement-component");
    if (record.settings?.mTracksTarget !== false)
      reasons.push("target-tracking");
    if (record.cast.targetCount !== 0) reasons.push("target-reference-list");
    if (record.packetInitialization.status !== "initialized-position-fields")
      reasons.push("packet-initialization");
    if (
      bits(record.controllerScalarB0) !== frame.correctionDisabledBits ||
      record.controllerScalarB4 !== 0
    )
      reasons.push("pending-packet-correction");
    if (record.uninterpretedMovementFields.length)
      reasons.push("movement-properties");
    if (
      !["none", "translated", "translated-external-powf-unverified"].includes(
        record.heightController.status,
      ) ||
      record.heightController.uninterpretedFields?.length
    )
      reasons.push("height-component");
    if (![null, "VerticalFacingFaceTarget"].includes(record.verticalFacingType))
      reasons.push("vertical-facing");
    // Construction clock and recorded packet age are distinct. Until their
    // relationship is established, a nonzero delay is not admitted here.
    if (record.settings?.mStartDelay !== 0)
      reasons.push("start-delay-clock-binding");
    return {
      status: reasons.length ? "unprepared" : "owned-frame-inputs-admitted",
      reasons,
    };
  }
  function initialize(record, createdAt = 0) {
    const admission = eligibility(record);
    if (admission.reasons.length)
      throw Error(`Unprepared missile frame: ${admission.reasons.join(", ")}`);
    if (!Number.isFinite(createdAt) || !Number.isFinite(f(createdAt)))
      throw Error("Invalid construction clock");
    const packet = record.packetInitialization;
    return {
      position: packet.currentPosition.map(f),
      initialPosition: packet.initialPosition.map(f),
      targetPosition: packet.targetPosition.map(f),
      speed: f(packet.movementSpeed),
      velocity: [0, 0, 0],
      cachedVelocity: [0, 0, 0],
      radius: 0,
      canPassOnce: !!frame.runtimeDefaults.canPassOnce,
      arrived: false,
      createdAt: f(createdAt),
      startDelay: f(record.settings.mStartDelay),
      heightController: record.heightController,
      verticalFacingType: record.verticalFacingType,
      history: [],
    };
  }
  function step(state, now, delta) {
    now = f(now);
    delta = f(delta);
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(delta) ||
      delta < 0 ||
      !state.position.every(Number.isFinite)
    )
      throw Error("Invalid missile frame inputs");
    // Original deque pushes the position before motion and retains 60 entries.
    state.history.unshift([...state.position]);
    if (state.history.length > 60) state.history.pop();
    const update = motion.fixedSpeedStep(
      state.position,
      state.targetPosition,
      state.speed,
      delta,
    );
    if (f(state.createdAt + state.startDelay) > now)
      update.displacement = [0, 0, 0];
    const arrival = controllers.fixedSpeedArrival(
      state.position,
      state.targetPosition,
      update.displacement,
      state.radius,
      state.canPassOnce,
    );
    if (arrival.arrived)
      update.displacement = controllers.snapDisplacement(
        state.position,
        state.targetPosition,
        update.displacement,
        state.radius,
      );
    state.arrived = arrival.arrived;
    state.canPassOnce = arrival.canPassOnce;
    const rawPredicted = state.position.map((n, i) =>
      f(n + update.displacement[i]),
    );
    const progress = controllers.fixedSpeedProgress(
      state.initialPosition,
      state.targetPosition,
      rawPredicted,
      state.arrived,
    );
    let height = null;
    if (state.heightController.type === "FollowTerrainHeightSolver")
      height = controllers.followTerrainHeight(
        state.position,
        rawPredicted,
        state.heightController.settings,
        terrain,
      );
    else if (state.heightController.type === "BlendedLinearHeightSolver")
      height = controllers.blendedLinearHeight(
        state.initialPosition,
        state.targetPosition,
        rawPredicted,
        progress,
        terrain,
      );
    if (height !== null) update.displacement[1] = f(height - state.position[1]);
    // The native callback sees the predicted point BEFORE the height solver.
    if (state.verticalFacingType === "VerticalFacingFaceTarget")
      update.velocity[1] = controllers.faceTargetVerticalVelocity(
        state.targetPosition,
        rawPredicted,
        state.speed,
      );
    state.velocity = update.velocity.every((n) => n === 0)
      ? [...state.cachedVelocity]
      : [...update.velocity];
    state.position = state.position.map((n, i) =>
      f(n + update.displacement[i]),
    );
    return {
      speed: state.speed,
      velocity: [...update.velocity],
      displacement: [...update.displacement],
      arrived: state.arrived,
      canPassOnce: state.canPassOnce,
      rawPredicted,
      progress,
      position: [...state.position],
      appliedVelocity: [...state.velocity],
      historySize: state.history.length,
    };
  }
  return { eligibility, initialize, step };
}
