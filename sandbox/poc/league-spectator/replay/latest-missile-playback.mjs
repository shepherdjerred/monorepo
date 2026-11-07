// Browser-side preview clock over the admitted controller/phase kernels. The
// supplied 60 Hz clock and linear display interpolation are reconstruction
// conventions, not a discovered native frame schedule or impact-position proof.
export function buildLatestMissilePlayback(
  analysis,
  bindings,
  frame,
  actors,
  endTime,
) {
  if (
    analysis.build !== "16.21.829.8620" ||
    analysis.protocol !== "20e09df23c66b85e" ||
    !Number.isFinite(endTime) ||
    endTime <= 0
  )
    throw Error("Unsupported missile playback inputs");
  const effectBySequence = new Map(
      bindings.records.map((r) => [r.sequence, r]),
    ),
    identities = new Map(
      analysis.eventIndex.identities.map((i) => [i.entityId, i]),
    ),
    traces = [],
    omitted = [],
    f = Math.fround;
  const order = (a, b) => a.time - b.time || a.sequence - b.sequence;
  for (const record of analysis.records) {
    const effect = effectBySequence.get(record.sequence),
      identity = identities.get(record.entityId),
      reasons = [
        ...frame.eligibility(record).reasons,
        ...actors.settings(record.behaviorSpecs).reasons,
      ];
    if (!identity) throw Error("Missile playback identity missing");
    if (identity.replications.length !== 1)
      reasons.push("repeated-identity-replication");
    if (record.elapsedSeconds !== 0)
      reasons.push("particle-history-at-later-snapshot");
    if (record.pendingChildren !== 0) reasons.push("child-registration");
    if (record.replicationPhase !== 0)
      reasons.push("nonzero-initial-phase-history");
    if (
      record.initialPresentationByte !== 0 ||
      identity.events.some((e) => e.opcode === 99 && e.value !== 0)
    )
      reasons.push("nondefault-presentation-state");
    if (effect?.status !== "prepared-definition")
      reasons.push("effect-definition");
    if (
      !record.behaviorSpecs?.some(
        (b) =>
          b.__type === "DestroyOnMovementComplete" && (b.mDelay ?? 0) === 0,
      )
    )
      reasons.push("nonterminal-movement-behavior");
    if (reasons.length) {
      omitted.push({
        sequence: record.sequence,
        entityId: record.entityId,
        reasons: [...new Set(reasons)],
      });
      continue;
    }
    const controller = frame.initialize(record),
      actor = actors.initialize(record),
      events = identity.events
        .filter((e) => e.opcode !== 99 && order(e, record) > 0)
        .sort(order),
      states = [],
      cadence = 1 / 60;
    let local = 0,
      tick = 1,
      eventIndex = 0,
      stopTime = null,
      direction = controller.targetPosition.map(
        (n, i) => n - controller.position[i],
      );
    const save = () => {
      const state = {
        time: record.time + local,
        position: [...controller.position],
        velocity: [...actor.velocity],
        stopped: actor.stopped,
        phase: actor.phase,
        direction: [...direction],
      };
      if (states.length && states.at(-1).time === state.time)
        states[states.length - 1] = state;
      else states.push(state);
    };
    save();
    while (record.time + local < endTime) {
      const event = events[eventIndex],
        next = Math.min(
          endTime - record.time,
          tick * cadence,
          event ? event.time - record.time : Infinity,
        );
      if (next < local) throw Error("Missile playback clock moved backwards");
      if (!actor.stopped && next > local) {
        const update = frame.step(
          controller,
          f(record.time + next),
          f(next - local),
        );
        if (Math.hypot(...update.velocity) > 0)
          direction = [...update.velocity];
        actor.velocity = [...update.appliedVelocity];
        actors.afterMovement(actor, update.arrived);
        controller.velocity = [...actor.velocity];
      }
      local = next;
      while (
        eventIndex < events.length &&
        events[eventIndex].time <= record.time + local
      ) {
        const notification = events[eventIndex++];
        if (notification.opcode === 56)
          actors.phaseNotification(actor, notification.target);
        else if (notification.opcode === 497) actors.stop(actor);
        else throw Error("Unprepared missile playback notification");
        controller.velocity = [...actor.velocity];
      }
      if (actor.stopped && stopTime === null) stopTime = record.time + local;
      save();
      if (actor.stopped && eventIndex === events.length) break;
      while (tick * cadence <= local + 1e-12) tick++;
      if (states.length > 16000)
        throw Error("Missile preview clock exceeded bounded decode window");
    }
    traces.push({
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      sequence: record.sequence,
      startTime: record.time,
      stopTime,
      effectId: effect.effectId,
      effect,
      states,
      castSource: [...record.cast.sourcePosition],
      castTarget: [...record.cast.targetPosition],
      renderParticlesAfterDestroy: actor.renderParticlesAfterDestroy,
      ignoredPresentationRecords: identity.events.filter((e) => e.opcode === 99)
        .length,
    });
  }
  const counts = {};
  for (const record of omitted)
    for (const reason of record.reasons)
      counts[reason] = (counts[reason] ?? 0) + 1;
  return {
    traces,
    omitted,
    summary: {
      traces: traces.length,
      omitted: omitted.length,
      reasons: counts,
      clockPolicy:
        "60 Hz supplied clock split at recorded phase/stop times; display positions interpolate between samples",
      limitations: [
        "Owner/type/child registries and collision/hit/cast dispatch are not reconstructed",
        "Presentation-byte semantics and fog are unresolved; rendering is an omniscient preview",
        "Impact positions, actual frame scheduling, particle activation and stop/linger policy are unverified",
      ],
    },
  };
}

export function sampleLatestMissileTrace(trace, time) {
  if (!Number.isFinite(time)) throw Error("Invalid missile sampling time");
  if (time < trace.startTime) return null;
  const states = trace.states;
  let low = 0,
    high = states.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (states[middle].time <= time) low = middle;
    else high = middle;
  }
  const a = states[low],
    b = states[low + 1];
  if (!b || a.stopped || b.time === a.time)
    return { ...a, position: [...a.position], velocity: [...a.velocity] };
  const share = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  return {
    ...a,
    position: a.position.map((n, i) =>
      Math.fround(n + (b.position[i] - n) * share),
    ),
    velocity: [...a.velocity],
  };
}
