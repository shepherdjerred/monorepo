function append(points, timeSeconds, values) {
  const last = points.at(-1);
  if (last?.[0] === timeSeconds)
    points[points.length - 1] = [timeSeconds, ...values];
  else if (
    last === undefined ||
    values.some((value, i) => value !== last[i + 1])
  )
    points.push([timeSeconds, ...values]);
}

/** Keep only current scalars and distinct observations for the verified roster. */
export function createRecordedChampionStatAccumulator(ids, durationSeconds) {
  if (ids.size !== 10)
    throw Error("Champion stat replay requires ten verified actors");
  const states = new Map(
    [...ids].map((id) => [
      id,
      { health: [], resource: [], gold: [], values: {} },
    ]),
  );
  let previousTime = -Infinity;

  return {
    observe(timeSeconds, writes) {
      if (
        !Number.isFinite(timeSeconds) ||
        timeSeconds < 0 ||
        timeSeconds > durationSeconds ||
        timeSeconds < previousTime
      )
        throw Error("Invalid champion stat packet clock");
      previousTime = timeSeconds;
      if (!Array.isArray(writes))
        throw Error("Champion stat replication writes are missing");
      for (const { entityId, ...values } of writes) {
        const state = states.get(entityId);
        if (
          state === undefined ||
          Object.values(values).some(
            (value) => !Number.isFinite(value) || value < 0,
          )
        )
          throw Error("Invalid verified champion stat write");
        Object.assign(state.values, values);
        if (values.gold !== undefined)
          append(state.gold, timeSeconds, [values.gold]);
        if (values.health !== undefined || values.healthMax !== undefined) {
          const { health, healthMax } = state.values;
          if (health !== undefined && healthMax > 0)
            append(state.health, timeSeconds, [health, healthMax]);
          else if (state.health.length > 0)
            throw Error("Recorded health lost its valid maximum");
        }
        if (values.resource !== undefined || values.resourceMax !== undefined) {
          const { resource, resourceMax } = state.values;
          if (resource !== undefined && resourceMax !== undefined)
            append(state.resource, timeSeconds, [resource, resourceMax]);
        }
      }
    },
    finish() {
      const championHealthTracks = [];
      const championResourceTracks = [];
      for (const [participantId, { health, resource, gold }] of states) {
        if (!health.length || !resource.length || !gold.length)
          throw Error("Recorded champion stats must cover the complete roster");
        if (
          health.some(([, current, max]) => current > max) ||
          resource.some(([, current, max]) => current > max)
        )
          throw Error("Recorded champion stats exceed the maximum");
        championHealthTracks.push({ participantId, points: health });
        championResourceTracks.push({ participantId, gold, resource });
      }
      return { championHealthTracks, championResourceTracks };
    },
  };
}
