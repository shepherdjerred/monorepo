const modelName =
  /^sru_(?:baron|riftherald|dragon_(?:air|water|earth|fire|chemtech|hextech))$/;
const campModelName =
  /^sru_(?:blue|crab|gromp|horde|krug(?:mini)?|murkwolf(?:mini)?|razorbeak(?:mini)?|red)$/;

export function readCurrentNeutralObjectiveModelIds(
  models,
  includeCamps = false,
) {
  if (!Array.isArray(models) || models.length > (includeCamps ? 19 : 8))
    throw Error("Invalid authored neutral objective model catalog");
  const result = new Map();
  const participants = new Set();
  for (const row of models) {
    if (!Array.isArray(row) || row.length !== 2)
      throw Error("Invalid authored neutral objective model binding");
    const [modelId, participantId] = row;
    if (
      typeof modelId !== "string" ||
      !(
        modelName.test(modelId) ||
        (includeCamps && campModelName.test(modelId))
      ) ||
      !Number.isSafeInteger(participantId) ||
      participantId <= 0 ||
      result.has(modelId) ||
      participants.has(participantId)
    )
      throw Error("Invalid authored neutral objective model binding");
    result.set(modelId, participantId);
    participants.add(participantId);
  }
  return result;
}

function neutralPaths(observations, end, worldPoint) {
  // Latest packet at the same primary clock owns the visible route.
  const byTime = new Map(observations.map((row) => [row.timeSeconds, row]));
  const ordered = [...byTime.values()];
  return ordered.flatMap(({ timeSeconds, speed, encodedWaypoints }, index) => {
    if (encodedWaypoints.length === 0) return [];
    const points = encodedWaypoints.map(worldPoint);
    let distance = 0;
    for (let point = 1; point < points.length; point++)
      distance += Math.hypot(
        points[point][0] - points[point - 1][0],
        points[point][1] - points[point - 1][1],
      );
    const traversable = Number.isFinite(speed) && speed > 0 && distance > 0;
    const endTimeSeconds = traversable
      ? Math.min(
          timeSeconds + distance / speed,
          ordered[index + 1]?.timeSeconds ?? end,
          end,
        )
      : timeSeconds;
    return [
      {
        timeSeconds,
        endTimeSeconds,
        points: traversable ? points : points.slice(0, 1),
        speeds: [{ timeSeconds, speed: traversable ? speed : 0, distance: 0 }],
      },
    ];
  });
}

/** Select exact recorded placement and movement for independently supplied authored models. */
export function prepareCurrentNeutralObjectiveScene({
  evidence,
  modelIds,
  waypointOrigin,
  durationSeconds,
  includeCamps = false,
}) {
  if (
    waypointOrigin.length !== 2 ||
    waypointOrigin[0] !== 7358 ||
    waypointOrigin[1] !== 7412 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    throw Error(
      "Current neutral objectives require the exact Map11 replay clock and waypoint origin",
    );
  const worldPoint = (point) =>
    point.map((value, axis) => 2 * value + waypointOrigin[axis]);
  const neutralObjectiveOmissions = {};
  function omit(reason) {
    neutralObjectiveOmissions[reason] =
      (neutralObjectiveOmissions[reason] ?? 0) + 1;
    return [];
  }
  const actors = includeCamps
    ? [...evidence.actors, ...evidence.campActors]
    : evidence.actors;
  const neutralObjectiveInstances = actors.flatMap(
    ({
      context,
      modelId,
      creationTimeSeconds,
      killTimeSeconds,
      observations,
    }) => {
      const participantId = modelIds.get(modelId);
      if (participantId === undefined) return omit("missingAuthoredModel");
      const end = killTimeSeconds ?? durationSeconds;
      if (
        !Number.isFinite(creationTimeSeconds) ||
        creationTimeSeconds < 0 ||
        end <= creationTimeSeconds ||
        end > durationSeconds ||
        observations.some(
          ({ timeSeconds }, index) =>
            !Number.isFinite(timeSeconds) ||
            timeSeconds < creationTimeSeconds ||
            timeSeconds >= end ||
            (index > 0 && timeSeconds < observations[index - 1].timeSeconds),
        )
      )
        throw Error(
          "Current neutral objective observation conflicts with its lifetime",
        );
      const paths = neutralPaths(observations, end, worldPoint);
      if (paths.length === 0) return omit("missingRecordedMotion");
      return [
        { context, participantId, creationTimeSeconds, killTimeSeconds, paths },
      ];
    },
  );
  const events = includeCamps
    ? [...evidence.events, ...evidence.hordeEvents].toSorted(
        (left, right) => left.timeSeconds - right.timeSeconds,
      )
    : evidence.events;
  const neutralObjectiveKills = events.map(
    ({
      subjectContext,
      actorContext,
      modelId,
      timeSeconds,
      encodedKillPosition,
    }) => ({
      subjectContext,
      actorContext,
      modelId,
      timeSeconds,
      ...(encodedKillPosition === undefined
        ? {}
        : { position: worldPoint(encodedKillPosition) }),
    }),
  );
  return {
    neutralObjectiveInstances,
    neutralObjectiveKills,
    neutralObjectiveOmissions,
    ...(includeCamps ? { neutralCampCoverage: evidence.campCoverage } : {}),
  };
}
