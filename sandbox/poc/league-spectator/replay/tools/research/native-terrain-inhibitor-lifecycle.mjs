function openState(intervals) {
  return intervals.at(-1)?.[1] === null ? "destroyed" : "alive";
}

function collectGameplayState(
  context,
  packet,
  state,
  intervals,
  pendingLosses,
) {
  const { timeSeconds, secondTimeBits } = packet;
  const loss = pendingLosses.get(context)?.[0];
  const verifiedLoss =
    loss?.secondTimeBits === secondTimeBits &&
    loss?.timeSeconds === timeSeconds;
  if (state === "destroyed") {
    if (!verifiedLoss || openState(intervals) === "destroyed")
      throw Error("Recorded inhibitor loss differs from verified loss history");
    pendingLosses.get(context).shift();
    intervals.push([timeSeconds, null]);
    return;
  }
  const interval = intervals.at(-1);
  if (
    interval === undefined ||
    interval[1] !== null ||
    interval[0] >= timeSeconds
  )
    throw Error(
      "Recorded inhibitor returned without a preceding verified loss",
    );
  interval[1] = timeSeconds;
}

export function createCurrentInhibitorLifecycleCollector(
  packetReader,
  opening,
  losses,
  readPacket,
) {
  const inactivity = new Map(
    [...opening.keys()].map((context) => [context, []]),
  );
  const snapshots = new Map(
    packetReader.keyframes.map(({ chunkOffset }) => [chunkOffset, new Map()]),
  );
  const pendingLosses = new Map(
    [...opening.keys()].map((context) => [context, []]),
  );
  for (const loss of losses) {
    const { context, timeSeconds, secondTimeBits } = loss;
    const queue = pendingLosses.get(context);
    if (
      queue === undefined ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds <= 0 ||
      timeSeconds > packetReader.durationSeconds ||
      !Number.isInteger(secondTimeBits) ||
      secondTimeBits < 0 ||
      secondTimeBits > 0xffffffff ||
      (queue.length > 0 && queue.at(-1).timeSeconds >= timeSeconds)
    )
      throw Error("Invalid independently verified inhibitor loss");
    queue.push(loss);
  }

  let opcode = null;
  let context = 0;
  function observe(packet) {
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const intervals = inactivity.get(context);
    if (opcode !== 947 || intervals === undefined) return;
    if (packet.stream === 2) {
      const snapshot = snapshots.get(packet.chunkOffset);
      const state = readPacket(packet.payload);
      if (
        snapshot === undefined ||
        snapshot.has(context) ||
        state !== openState(intervals)
      )
        throw Error(
          "Indexed inhibitor snapshot differs from recorded lifecycle",
        );
      snapshot.set(context, state);
    } else if (packet.stream === 1) {
      if (
        packet.timeSeconds <= 0 ||
        packet.timeSeconds > packetReader.durationSeconds
      )
        throw Error(
          "Recorded inhibitor transition is outside the replay clock",
        );
      collectGameplayState(
        context,
        packet,
        readPacket(packet.payload),
        intervals,
        pendingLosses,
      );
    }
  }
  function finish() {
    if ([...pendingLosses.values()].some((pending) => pending.length > 0))
      throw Error("Recorded inhibitor lifecycle is missing a verified loss");
    if (
      [...snapshots.values()].some(
        (snapshot) => snapshot.size !== inactivity.size,
      )
    )
      throw Error(
        "Recorded inhibitor lifecycle is missing an indexed snapshot state",
      );

    return {
      inactivity,
      losses,
      presentationOmissions: [],
      unresolvedSnapshotStates: [],
      renderableLosses: losses,
      read(timeSeconds, options) {
        const { keyframe } = packetReader.read(timeSeconds, options);
        const snapshot = snapshots.get(keyframe.chunkOffset);
        if (!snapshot) throw Error("Missing indexed inhibitor snapshot");
        return {
          keyframeTimeSeconds: keyframe.timeSeconds,
          inhibitors: [...snapshot].map(([context, keyframeState]) => ({
            context,
            keyframeState,
            seekState: inactivity
              .get(context)
              .some(
                ([loss, end]) =>
                  loss <= timeSeconds && (end === null || timeSeconds < end),
              )
              ? "destroyed"
              : "alive",
          })),
        };
      },
    };
  }
  return { observe, finish };
}

export function collectCurrentInhibitorLifecycle(
  packetReader,
  opening,
  losses,
  packets,
  readPacket,
) {
  const collector = createCurrentInhibitorLifecycleCollector(
    packetReader,
    opening,
    losses,
    readPacket,
  );
  for (const packet of packets) collector.observe(packet);
  return collector.finish();
}
