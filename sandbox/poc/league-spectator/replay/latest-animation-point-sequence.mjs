// Compose already-admitted native components for one bone-bound animation event.
// Actor roots, local samples, event frames, clocks, quality and seeds are inputs.
export function createAnimationPointSequence({
  events,
  world,
  rig,
  attachments,
  quads,
  eventSpec,
  activation,
  emitters,
  seed = 1n,
  quality = 0,
}) {
  if (
    !eventSpec ||
    !(eventSpec.endFrame < 0) ||
    !activation ||
    activation.pairs?.length !== 1 ||
    activation.pairs[0][0] === 0 ||
    activation.pairs[0][1] !== 0 ||
    activation.detachable ||
    activation.poseAfterimage ||
    activation.scalePlaySpeed ||
    !Array.isArray(emitters) ||
    !emitters.length ||
    emitters.some(
      (e) =>
        !Number.isSafeInteger(e.index) ||
        e.index < 0 ||
        e.handle?.emitterIndex !== e.index ||
        e.handle?.effectId !== emitters[0].handle?.effectId,
    ) ||
    new Set(emitters.map((e) => e.index)).size !== emitters.length ||
    ![0, 1, 2, 3].includes(quality) ||
    typeof seed !== "bigint"
  )
    throw Error("Unadmitted bone-bound animation point sequence");
  const k = quads.kernel,
    temp = 0x100c0000,
    matrix = 0x100c0100,
    decode = (h) => Uint8Array.from(h.match(/../g), (v) => parseInt(v, 16)),
    floats = (raw) =>
      Array.from({ length: raw.length / 4 }, (_, i) =>
        new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat32(
          i * 4,
          true,
        ),
      );
  let active = null,
    lastTime = null,
    lastFrame = null,
    closed = false,
    poisoned = false;
  events.load([eventSpec]);
  function reset() {
    if (closed) throw Error("Closed animation point sequence");
    const cleanup = active ? attachments.cleanup() : null;
    for (const emitter of active?.emitters ?? [])
      if (emitter.checkpoint) quads.releaseCheckpoint(emitter.checkpoint);
    active = null;
    lastTime = null;
    lastFrame = null;
    events.reset();
    return cleanup;
  }
  return {
    reset,
    step(input) {
      if (
        closed ||
        poisoned ||
        !input ||
        !Number.isFinite(input.time) ||
        input.time < 0 ||
        !Number.isFinite(input.frame) ||
        (lastTime !== null && input.time < lastTime) ||
        (lastFrame !== null && input.frame < lastFrame)
      )
        throw Error(
          "Invalid animation point sequence clock; seek requires reset and resimulation",
        );
      try {
        const pose = world.sample(input.localHex, input.rootHex, true),
          joints = rig.attachmentJoints(pose.worldHex),
          scheduling = events.step(input.frame),
          requests = [];
        for (const request of scheduling.requests) {
          if (
            request.kind !== "activate-request" ||
            request.event !== eventSpec.id ||
            active
          )
            throw Error(
              "Unadmitted animation effect interruption/release request",
            );
          const result = attachments.activate({
              ...activation,
              joints,
              ownerPositionHex: input.rootHex.slice(0, 24),
            }),
            sources = result.requests.filter(
              (r) => r.kind === "source-binding-request",
            ),
            creates = result.requests.filter(
              (r) => r.kind === "create-effect-request",
            );
          if (
            result.retained !== 1 ||
            sources.length !== 1 ||
            sources[0].binding.kind !== "bone" ||
            creates.length !== 1 ||
            !creates[0].created
          )
            throw Error("Unadmitted point sequence attachment result");
          active = {
            start: input.time,
            key: sources[0].binding.resolvedBoneKey,
            previous: null,
            emitters: emitters.map((e) => ({ ...e, checkpoint: null })),
          };
          requests.push(...result.requests);
        }
        const draws = [];
        if (active) {
          const selected = joints.filter(
            (j) => j.resolvedBoneKey === active.key,
          );
          if (
            !selected.length ||
            selected.some((j) => j.transformHex !== selected[0].transformHex)
          )
            throw Error("Ambiguous point sequence source pose");
          const transform = decode(selected[0].transformHex),
            position = floats(transform.subarray(0, 12));
          for (const emitter of active.emitters) {
            if (emitter.checkpoint) quads.restore(emitter.checkpoint);
            else {
              quads.selectGraph(emitter.handle);
              quads.reset(seed, quality);
            }
            k.engine.mem_write(temp, transform);
            // This is the same original quaternion-to-orientation helper called
            // by the client's bone-follow orientation getter (0x76f870).
            k.callNative(0x148d170, { RDI: temp + 24, RSI: matrix });
            const basis = floats(k.read(matrix, 64)),
              quadInput = {
                time: Math.fround(input.time - active.start),
                previous: active.previous ?? position,
                current: position,
                basis,
                viewPosition: input.viewPosition,
              },
              output = quads.frame(quadInput),
              old = emitter.checkpoint;
            emitter.checkpoint = quads.checkpoint();
            if (old) quads.releaseCheckpoint(old);
            draws.push({
              emitterIndex: emitter.index,
              input: quadInput,
              output,
            });
          }
          active.previous = position;
        }
        lastTime = input.time;
        lastFrame = input.frame;
        return { pose, scheduling, attachmentRequests: requests, draws };
      } catch (error) {
        poisoned = true;
        throw error;
      }
    },
    close() {
      if (!closed) {
        reset();
        closed = true;
      }
    },
  };
}
