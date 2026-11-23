const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const inhibitorCount = 6;

function readSnapshot(packetReader, timeSeconds) {
  const { keyframe, packets } = packetReader.read(timeSeconds);
  const states = new Map();
  let opcode = null;
  let context = 0;
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      break;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode !== 947 || packet.payload.length !== 1) continue;
    const value = packet.payload[0];
    if (value !== 0x91 && value !== 0x81) continue;
    const state = value === 0x91 ? "alive" : "destroyed";
    if (states.has(context) && states.get(context) !== state)
      throw Error("Conflicting inhibitor states in snapshot");
    states.set(context, state);
  }
  return states;
}

/** Snapshot and loss evidence for the supported short and Ranked Map11 fixtures. */
export function prepareNativeTerrainInhibitors(prepared) {
  const { packetReader, observations } = prepared;
  if (packetReader.build !== build || packetReader.protocol !== protocol)
    throw Error("Expected exact-build Map11 replay");
  const opening = readSnapshot(packetReader, 0);
  if (
    opening.size !== inhibitorCount ||
    [...opening.values()].some((state) => state !== "alive")
  )
    throw Error("Expected six opening inhibitor states");

  // Some recordings have no footer-verified structure history. Snapshots
  // remain available, and a seek between them has no corroborated event state.
  const losses =
    observations.structures
      ?.filter(({ kind }) => kind === "inhibitor-destruction")
      .map((loss) => Object.freeze({ ...loss })) ?? null;
  const history = new Map();
  for (const loss of losses ?? []) {
    const { context, timeSeconds } = loss;
    if (
      !opening.has(context) ||
      history.has(context) ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds <= 0 ||
      timeSeconds > packetReader.durationSeconds
    )
      throw Error("Unsupported inhibitor loss history");
    history.set(context, timeSeconds);
  }

  const snapshots = new Map();
  for (const { timeSeconds, chunkOffset } of packetReader.keyframes) {
    const states =
      timeSeconds === 0 ? opening : readSnapshot(packetReader, timeSeconds);
    const snapshot = new Map();
    for (const context of opening.keys()) {
      const state = states.get(context);
      if (state === undefined) throw Error("Missing indexed inhibitor state");
      const lostAt = history.get(context) ?? Infinity;
      if (losses !== null && timeSeconds !== lostAt) {
        const expected = timeSeconds > lostAt ? "destroyed" : "alive";
        if (state !== expected)
          throw Error("Inhibitor snapshot differs from verified loss history");
      }
      snapshot.set(
        context,
        timeSeconds === lostAt ? "unknown-same-time" : state,
      );
    }
    snapshots.set(chunkOffset, snapshot);
  }
  return {
    losses,
    read(timeSeconds, options) {
      const { keyframe } = packetReader.read(timeSeconds, options);
      const snapshot = snapshots.get(keyframe.chunkOffset);
      if (!snapshot) throw Error("Missing indexed inhibitor snapshot");
      return {
        keyframeTimeSeconds: keyframe.timeSeconds,
        inhibitors: [...snapshot].map(([context, keyframeState]) => ({
          context,
          keyframeState,
          seekState:
            losses === null
              ? timeSeconds === keyframe.timeSeconds
                ? keyframeState
                : "unknown"
              : timeSeconds >= (history.get(context) ?? Infinity)
                ? "destroyed"
                : "alive",
        })),
      };
    },
  };
}
