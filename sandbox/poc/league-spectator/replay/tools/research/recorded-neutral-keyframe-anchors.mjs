export function createNeutralKeyframeAnchorCollector(readName, readWaypoints) {
  let chunkOffset;
  let opcode = null;
  let context = 0;
  const names = new Map();
  const points = new Map();
  const candidates = new Map();

  function flush() {
    for (const [entityId, point] of points) {
      const creation = names.get(entityId);
      if (
        point == null ||
        creation == null ||
        creation.timeSeconds !== point.timeSeconds ||
        creation.secondTimeBits !== point.secondTimeBits
      )
        continue;
      const rows = candidates.get(entityId) ?? [];
      rows.push({ point, body: creation.body });
      candidates.set(entityId, rows);
    }
    names.clear();
    points.clear();
  }

  function observe(packet) {
    if (packet.stream !== 2) return;
    if (packet.chunkOffset !== chunkOffset) {
      flush();
      chunkOffset = packet.chunkOffset;
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const { payload, timeSeconds, secondTimeBits } = packet;
    if (opcode === 392) {
      names.set(
        context,
        names.has(context)
          ? null
          : { body: payload.slice(), timeSeconds, secondTimeBits },
      );
    } else if (opcode === 96 || opcode === 1174) {
      const { records, syncId } = readWaypoints(opcode, payload);
      for (const { entityId, motion, speed, encodedWaypoints } of records) {
        points.set(
          entityId,
          points.has(entityId) || encodedWaypoints.length !== 1
            ? null
            : {
                timeSeconds,
                secondTimeBits,
                opcode,
                syncId,
                speed: motion?.speed ?? speed,
                encodedWaypoints,
              },
        );
      }
    }
  }

  function finish(actors, duration) {
    flush();
    return actors.flatMap((actor) => {
      const ordinary = new Set(
        actor.observations.map(({ timeSeconds }) => timeSeconds),
      );
      const matches = (candidates.get(actor.context) ?? []).filter(
        ({ point: { timeSeconds }, body }) =>
          timeSeconds > actor.creationTimeSeconds &&
          timeSeconds < (actor.killTimeSeconds ?? duration) &&
          !ordinary.has(timeSeconds) &&
          readName(body) === actor.objectName,
      );
      const count = new Map();
      for (const {
        point: { timeSeconds },
      } of matches)
        count.set(timeSeconds, (count.get(timeSeconds) ?? 0) + 1);
      const observations = matches
        .map(({ point }) => point)
        .filter(({ timeSeconds }) => count.get(timeSeconds) === 1)
        .toSorted((a, b) => a.timeSeconds - b.timeSeconds);
      return observations.length === 0
        ? []
        : [{ context: actor.context, observations }];
    });
  }

  return { observe, finish };
}
