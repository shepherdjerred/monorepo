// A traced component of missile motion, not a complete missile simulation.
// Initialization, target tracking, height solvers, collision and lifetime follow
// separate native paths and must be established before presenting a trajectory.
export function createLatestMissileMotion(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.className !== "FixedSpeedMovement" ||
    definition.stepRva !== 0x87f4e0 ||
    definition.vectorHelperRva !== 0x148ddc0 ||
    !Number.isFinite(definition.epsilon) ||
    definition.epsilon <= 0
  )
    throw Error("Unsupported missile motion package");
  const f = Math.fround,
    epsilon = definition.epsilon;
  function fixedSpeedStep(position, target, speed, seconds) {
    if (
      position.length !== 3 ||
      target.length !== 3 ||
      ![...position, ...target, speed, seconds].every(Number.isFinite) ||
      seconds < 0
    )
      throw Error("Invalid missile motion inputs");
    speed = f(speed);
    seconds = f(seconds);
    let velocity = target.map((value, lane) => f(f(value) - f(position[lane])));
    // Native helper 0x148ddc0: normalize in XYZ, then scale to XZ speed.
    // Preserve its tiny-speed/degenerate-vector branches and float32 ordering.
    if (Math.abs(speed) > epsilon) {
      const lengthSquared = f(
        f(f(velocity[0] * velocity[0]) + f(velocity[1] * velocity[1])) +
          f(velocity[2] * velocity[2]),
      );
      if (lengthSquared > epsilon) {
        const reciprocal = f(1 / f(Math.sqrt(lengthSquared)));
        velocity = velocity.map((value) => f(value * reciprocal));
      }
      const planarLength = f(
        Math.sqrt(
          f(f(velocity[0] * velocity[0]) + f(velocity[2] * velocity[2])),
        ),
      );
      if (!(epsilon > planarLength)) {
        const scale = f(speed / planarLength);
        velocity = velocity.map((value) => f(value * scale));
      }
    }
    return {
      velocity,
      displacement: velocity.map((value) => f(value * seconds)),
    };
  }
  function fixedSpeedSettings(component) {
    if (component.__type !== "FixedSpeedMovement")
      throw Error("Wrong missile movement component");
    return Object.fromEntries(
      Object.entries(definition.fields).map(([name, field]) => {
        const value = Object.hasOwn(component, name)
          ? component[name]
          : field.default;
        if (
          (field.type === "bool" && typeof value !== "boolean") ||
          (field.type === "f32" && !Number.isFinite(value))
        )
          throw Error(`Invalid missile movement property ${name}`);
        return [name, value];
      }),
    );
  }
  return { fixedSpeedStep, fixedSpeedSettings };
}

// Binding a spell and identifying its motion type does not admit its trajectory.
export function bindLatestMissileSpell(record, subjects) {
  const owner = subjects.get(record.cast.ownerId),
    sourceMatches =
      !!owner &&
      (!record.cast.sourceName ||
        record.cast.sourceName.toLowerCase() === owner.character.toLowerCase()),
    spell = sourceMatches ? owner.catalog.spells[record.cast.spellHash] : null;
  return {
    ownerCharacter: owner?.character ?? null,
    spell: spell ?? null,
    bindingStatus: !owner
      ? "Owner not bound"
      : !sourceMatches
        ? "Source character not bound"
        : !spell
          ? "Spell definition absent from owner catalog"
          : "Spell identity resolved; trajectory and visual effect not reconstructed",
  };
}

// Native target helper 0x873e70, followed by the target-height addition at
// 0x88a155..0x88a16b. Range projection requires runtime spell/caster stats;
// coincident movement cells require the separately recorded facing vector.
export function initializeLatestMissileTarget(record, settings, terrain) {
  if (
    typeof settings.mProjectTargetToCastRange !== "boolean" ||
    !Number.isFinite(settings.mOffsetInitialTargetHeight)
  )
    throw Error("Invalid native missile target settings");
  if (settings.mProjectTargetToCastRange)
    return { status: "unresolved-cast-range-projection", position: null };
  if (
    terrain.sameMovementCell(
      record.cast.targetPosition,
      record.cast.sourcePosition,
    )
  )
    return { status: "unresolved-facing-derived-endpoint", position: null };
  const position = record.cast.targetPosition.map(Math.fround),
    ground = terrain.sampleHeight(position[0], position[2]);
  // The native caller initializes its height output to zero and ignores the
  // wrapper's false return outside bounds. Retain this case explicitly.
  position[1] = Math.fround(
    (ground.inside ? ground.height : 0) +
      Math.fround(settings.mOffsetInitialTargetHeight),
  );
  return {
    status: "initialized",
    position,
    groundHeightStatus: ground.inside
      ? "navgrid"
      : "outside-navgrid-native-zero",
    scope:
      "Initial target only; later packet height replacement, target tracking, height solver and entity trajectory remain separate",
  };
}

// Join recorded identities, not simulated lifetimes. Repeated replication records
// and events without an opcode-28 identity stay explicit. Neither a phase target
// nor a stop notification proves that the entity or its particles are gone.
export function indexLatestMissileEvents(report) {
  const identities = new Map(),
    unboundEvents = [],
    order = (a, b) => a.time - b.time || a.sequence - b.sequence;
  const validate = (record) => {
    if (
      !Number.isInteger(record.entityId) ||
      record.entityId <= 0 ||
      record.entityId > 0xffffffff ||
      !Number.isFinite(record.time) ||
      !Number.isSafeInteger(record.sequence)
    )
      throw Error("Invalid missile event identity or ordering");
  };
  for (const record of report.missiles) {
    validate(record);
    if (record.entityId !== record.cast.networkId)
      throw Error("Missile identity disagrees with decoded CastInfo");
    if (!identities.has(record.entityId))
      identities.set(record.entityId, {
        entityId: record.entityId,
        replications: [],
        events: [],
      });
    identities.get(record.entityId).replications.push(record);
  }
  for (const event of report.missileEvents) {
    validate(event);
    if (![56, 99, 497].includes(event.opcode))
      throw Error("Unprepared missile event opcode");
    const identity = identities.get(event.entityId);
    if (identity) identity.events.push(event);
    else unboundEvents.push(event);
  }
  const records = [...identities.values()];
  for (const identity of records) {
    identity.replications.sort(order);
    identity.events.sort(order);
  }
  const boundEvents = records.flatMap((identity) => identity.events),
    count = (events, opcode) =>
      events.filter((event) => event.opcode === opcode).length;
  return {
    identities: records,
    unboundEvents: unboundEvents.sort(order),
    summary: {
      identities: records.length,
      replicationRecords: report.missiles.length,
      repeatedIdentityRecords: report.missiles.length - records.length,
      contextDisagreements: report.missiles.filter(
        (record) => record.contextId !== record.entityId,
      ).length,
      eventRecords: report.missileEvents.length,
      boundEventRecords: boundEvents.length,
      boundPhaseRecords: count(boundEvents, 56),
      boundPresentationRecords: count(boundEvents, 99),
      boundStopRecords: count(boundEvents, 497),
      eventsBeforeFirstReplication: records.reduce(
        (sum, identity) =>
          sum +
          identity.events.filter(
            (event) => order(event, identity.replications[0]) < 0,
          ).length,
        0,
      ),
      sameTimeEventsBeforeFirstReplication: records.reduce(
        (sum, identity) =>
          sum +
          identity.events.filter(
            (event) =>
              event.time === identity.replications[0].time &&
              event.sequence < identity.replications[0].sequence,
          ).length,
        0,
      ),
      unboundEventRecords: unboundEvents.length,
      unboundEventIdentities: new Set(
        unboundEvents.map((event) => event.entityId),
      ).size,
    },
    scope:
      "Network-identity join only; repeated records, identity reuse, unbound events, phase execution, entity removal and VFX linger require separate lifecycle rules",
  };
}

export function analyzeLatestMissiles(
  report,
  actors,
  motionDefinition,
  worldContext,
) {
  if (
    report.build !== motionDefinition.build ||
    report.build !== worldContext.manifest.build ||
    report.protocol !== worldContext.manifest.protocol
  )
    throw Error("Missile analysis build mismatch");
  const motion = createLatestMissileMotion(motionDefinition),
    subjects = new Map();
  for (const actor of actors) {
    if (
      subjects.has(actor.entityId) ||
      actor.catalog.schema !== 2 ||
      actor.catalog.character.toLowerCase() !== actor.character.toLowerCase()
    )
      throw Error("Duplicate missile owner or incompatible spell catalog");
    subjects.set(actor.entityId, actor);
  }
  const records = report.missiles.map((record) => {
    const { spell, ...binding } = bindLatestMissileSpell(record, subjects),
      spec = spell?.data.mMissileSpec,
      component = spec?.movementComponent,
      movementType = component?.__type ?? null,
      settings =
        movementType === "FixedSpeedMovement"
          ? motion.fixedSpeedSettings(component)
          : null,
      targetInitialization = settings
        ? initializeLatestMissileTarget(record, settings, worldContext.terrain)
        : { status: "untranslated-movement-component", position: null },
      startInitialization = spell
        ? worldContext.initialization.initializeStart(
            record,
            spell.data,
            worldContext.terrain,
          )
        : { status: "spell-unprepared", position: null },
      packetInitialization = settings
        ? worldContext.initialization.initializeFixedSpeedPacket(
            record,
            settings,
            startInitialization,
            targetInitialization,
            worldContext.terrain,
          )
        : { status: "untranslated-movement-component", currentPosition: null };
    return {
      ...record,
      ...binding,
      definitionName: spell?.name ?? null,
      movementType,
      behaviorSpecs: spec ? (spec.behaviors ?? []) : null,
      heightSolverType: spec?.heightSolver?.__type ?? null,
      verticalFacingType: spec?.verticalFacing?.__type ?? null,
      uninterpretedMovementFields: component
        ? Object.keys(component).filter(
            (name) =>
              name !== "__type" &&
              !Object.hasOwn(motionDefinition.fields, name) &&
              name !== "mStartBoneName",
          )
        : [],
      heightController: !spell
        ? { status: "spell-unprepared", type: null, settings: null }
        : !spec
          ? { status: "missile-spec-unprepared", type: null, settings: null }
          : spec.heightSolver
            ? worldContext.controllers.heightSettings(spec.heightSolver)
            : { status: "none", type: null, settings: null },
      sourcePositionStatus: record.cast.forceRecordedSourcePosition
        ? "Native start initializer selects recorded cast XYZ; later start offsets and trajectory remain separate"
        : "Native start initializer may sample caster/terrain/attachment; recorded XYZ is the fallback when caster is unavailable",
      settings,
      targetInitialization,
      startInitialization,
      packetInitialization,
      nativeDefaultsApplied: settings
        ? Object.keys(settings).filter(
            (name) => !Object.hasOwn(component, name),
          )
        : [],
      trajectoryStatus: !spell
        ? binding.bindingStatus
        : !movementType
          ? "Implicit/default movement specification unprepared"
          : settings
            ? "Fixed-speed components and nonprojected initial targets translated; remaining initialization, tracked target/height state, collision and lifetime unresolved"
            : `Motion component not translated: ${movementType}`,
    };
  });
  for (const record of records) {
    record.frameAdmission = worldContext.frame.eligibility(record);
    record.phaseAdmission = worldContext.actors.settings(record.behaviorSpecs);
    if (!record.frameAdmission.reasons.length)
      record.trajectoryStatus =
        "Complete owned no-target controller frame translated; actor collision, phase/stop/lifetime, frame schedule and presentation remain unresolved";
  }
  const fixedSpeed = records.filter((record) => record.settings),
    movementTypes = {},
    eventIndex = indexLatestMissileEvents(report);
  for (const record of records)
    if (record.movementType)
      movementTypes[record.movementType] =
        (movementTypes[record.movementType] ?? 0) + 1;
  return {
    build: report.build,
    protocol: report.protocol,
    records,
    eventIndex,
    summary: {
      records: records.length,
      ...eventIndex.summary,
      forcedRecordedSourceRecords: records.filter(
        (record) => record.cast.forceRecordedSourcePosition,
      ).length,
      casterAttachmentSourceRecords: records.filter(
        (record) => !record.cast.forceRecordedSourcePosition,
      ).length,
      initializedFixedSpeedTargets: records.filter(
        (record) => record.targetInitialization.status === "initialized",
      ).length,
      initializedRecordedStarts: records.filter(
        (record) => record.startInitialization.status === "initialized",
      ).length,
      initializedFixedSpeedPacketPositions: records.filter(
        (record) =>
          record.packetInitialization.status === "initialized-position-fields",
      ).length,
      translatedTerrainHeightRecords: records.filter(
        (record) => record.heightController.status === "translated",
      ).length,
      blendedHeightExternalMathRecords: records.filter(
        (record) =>
          record.heightController.status ===
          "translated-external-powf-unverified",
      ).length,
      ownedFrameInputRecords: records.filter(
        (record) => !record.frameAdmission.reasons.length,
      ).length,
      translatedPhaseCallbackRecords: records.filter(
        (record) => !record.phaseAdmission.reasons.length,
      ).length,
      ownedMovementAndPhaseRecords: records.filter(
        (record) =>
          !record.frameAdmission.reasons.length &&
          !record.phaseAdmission.reasons.length,
      ).length,
      replicationPhaseRecords: records.filter(
        (record) => record.replicationPhase !== 0,
      ).length,
      pendingChildRecords: records.filter(
        (record) => record.pendingChildren !== 0,
      ).length,
      nonzeroInitialPresentationRecords: records.filter(
        (record) => record.initialPresentationByte !== 0,
      ).length,
      boundSpellRecords: records.filter((record) => record.definitionName)
        .length,
      uniqueBoundSpells: new Set(
        records
          .filter((record) => record.definitionName)
          .map(
            (record) =>
              `${record.ownerCharacter.toLowerCase()}/${record.cast.spellHash}`,
          ),
      ).size,
      movementTypes,
      fixedSpeedComponents: fixedSpeed.length,
      fixedSpeedTrackingTargets: fixedSpeed.filter(
        (record) => record.settings.mTracksTarget,
      ).length,
      fixedSpeedNonTracking: fixedSpeed.filter(
        (record) => !record.settings.mTracksTarget,
      ).length,
      fixedSpeedNativeTrackingDefaults: fixedSpeed.filter((record) =>
        record.nativeDefaultsApplied.includes("mTracksTarget"),
      ).length,
      renderedProjectiles: 0,
    },
  };
}
