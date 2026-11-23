const conflictingBit = Symbol("conflicting turret bits");

/** Collect scalar snapshot evidence alongside the index for the same replay. */
export function createTurretSnapshotCollector() {
  const snapshots = new Map();
  let opening;
  let current;
  let opcode;
  let context;

  return {
    observeRawPacket(packet) {
      if (packet.stream !== 2) return;
      if (packet.blockOffset === 0) {
        current = new Map();
        snapshots.set(packet.chunkOffset, current);
        opening ??= current;
        opcode = null;
        context = 0;
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (
        opcode !== 1012 ||
        packet.payload.length !== 41 ||
        (current !== opening && !opening.has(context))
      )
        return;
      const dead = (packet.payload[13] & 8) === 0;
      if (!current.has(context)) current.set(context, dead);
      else if (current.get(context) !== dead)
        current.set(context, conflictingBit);
    },

    finish(packetReader, observations) {
      const losses = observations.turrets?.map((loss) => ({ ...loss })) ?? null;
      const contexts = new Set();
      for (const loss of losses ?? []) {
        const { kind, context, timeSeconds } = loss;
        if (
          kind !== "turret-destruction" ||
          !Number.isInteger(context) ||
          context < 0 ||
          context > 0xffffffff ||
          !Number.isFinite(timeSeconds) ||
          timeSeconds < 0 ||
          timeSeconds > packetReader.durationSeconds ||
          contexts.has(context)
        )
          throw Error("Invalid verified turret loss history");
        contexts.add(context);
      }
      // Keep only the corroborated cohort. In particular the opening packet
      // family by itself does not establish which other structures are turrets.
      for (const snapshot of snapshots.values())
        for (const context of snapshot.keys())
          if (!contexts.has(context)) snapshot.delete(context);

      return function readTurretState(timeSeconds, options) {
        // Selecting a window validates the time and original buffer without
        // expanding any chunks. The scalar snapshot was already collected.
        const { keyframe } = packetReader.read(timeSeconds, options);
        if (losses === null) return null;
        const keyframeTimeSeconds = keyframe.timeSeconds;
        const snapshot = snapshots.get(keyframe.chunkOffset);
        if (!snapshot) throw Error("Missing indexed turret snapshot");
        const turrets = losses.map((loss) => {
          const { context, defendingPartition, timeSeconds: lostAt } = loss;
          const observedDead = snapshot.get(context);
          let keyframeState;
          if (observedDead === conflictingBit)
            throw Error("Conflicting turret bits in the indexed snapshot");
          if (keyframeTimeSeconds === lostAt) {
            keyframeState = "unknown-same-time";
          } else if (observedDead === undefined) {
            keyframeState = "unknown-missing";
          } else {
            const expectedDead = keyframeTimeSeconds > lostAt;
            if (observedDead !== expectedDead)
              throw Error(
                "Turret snapshot bit disagrees with verified loss history",
              );
            keyframeState = observedDead ? "dead" : "alive";
          }
          return {
            context,
            defendingPartition,
            keyframeState,
            seekState: timeSeconds >= lostAt ? "dead" : "alive",
          };
        });
        return { keyframeTimeSeconds, turrets };
      };
    },
  };
}
