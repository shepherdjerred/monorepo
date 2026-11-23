import {
  maxFollowBracketSeconds,
  maxFollowGapSeconds,
} from "./reference-position-samples.mjs";

const participantKeyScope = "one-based-rofl-footer-row";
const identityFields = [
  "replaySha256",
  "build",
  "protocol",
  "durationMilliseconds",
];

function requireIdentity(value, identity, label) {
  if (
    value?.schemaVersion !== 1 ||
    identityFields.some((field) => value[field] !== identity[field])
  )
    throw Error(`${label} replay identity mismatch`);
}

function validPosition(position) {
  return (
    Array.isArray(position) &&
    position.length === 3 &&
    [...position].every(Number.isFinite)
  );
}

function validTime(time, duration) {
  return Number.isFinite(time) && time >= 0 && time <= duration;
}

function requireActor(actors, actor, count, label) {
  const { key, position } = actor ?? {};
  if (
    !Number.isInteger(key) ||
    key < 1 ||
    key > count ||
    actors.has(key) ||
    !validPosition(position)
  )
    throw Error(`Invalid or duplicate ${label} actor`);
  actors.set(key, position);
}

function prepareReference(identity, reference) {
  const {
    replaySha256,
    build,
    protocol,
    durationMilliseconds,
    participantCount,
  } = identity;
  if (
    !/^[a-f0-9]{64}$/.test(replaySha256) ||
    typeof build !== "string" ||
    !/^[a-f0-9]{16}$/.test(protocol) ||
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds <= 0 ||
    !Number.isSafeInteger(participantCount) ||
    participantCount <= 0
  )
    throw Error("Invalid replay identity");
  requireIdentity(reference, identity, "Reference");
  const capture = reference.reference;
  const captureMethod =
    capture?.captureMethod === undefined ? "continuous" : capture.captureMethod;
  if (
    reference.purpose !== "local-verification-only" ||
    capture?.source !== "riot-replay-api-camera-attachment" ||
    capture.replayIdentity !== "operator-confirmed" ||
    capture.replayDigestAttestedByApi !== false ||
    capture.participantKey !== participantKeyScope ||
    !["paused-seek", "continuous", "continuous-follow"].includes(captureMethod)
  )
    throw Error("Invalid reference capture scope");
  const { requestedTimes, samples } = reference;
  if (
    !Array.isArray(requestedTimes) ||
    requestedTimes.length < 2 ||
    !Array.isArray(samples)
  )
    throw Error("Expected at least two reference time groups");

  const duration = durationMilliseconds / 1000;
  const header = {
    schemaVersion: 1,
    replaySha256,
    build,
    protocol,
    durationMilliseconds,
    participantCount,
    captureMethod,
    participantKey: participantKeyScope,
  };
  if (captureMethod === "continuous-follow")
    return {
      ...prepareFollowReference(reference, duration, participantCount),
      duration,
      header,
    };

  const calibrationCount = Math.ceil(requestedTimes.length / 2);
  const groups = new Map();
  let previousTime = -Infinity;
  for (const requestedTime of requestedTimes) {
    if (!validTime(requestedTime, duration) || requestedTime <= previousTime)
      throw Error(
        "Reference request times must be strictly increasing within the replay",
      );
    previousTime = requestedTime;
    groups.set(requestedTime, {
      requestedTime,
      time: null,
      split: groups.size < calibrationCount ? "calibration" : "held-out",
      actors: new Map(),
    });
  }
  for (const sample of samples) {
    const { requestedTime, time } = sample ?? {};
    const group = groups.get(requestedTime);
    const elapsed = time - requestedTime;
    if (
      !group ||
      !validTime(time, duration) ||
      (group.time !== null && group.time !== time) ||
      (captureMethod === "paused-seek"
        ? Math.abs(elapsed) > 0.002
        : elapsed < 0 || elapsed > 0.5)
    )
      throw Error("Invalid reference sample clock");
    group.time = time;
    requireActor(group.actors, sample, participantCount, "reference");
  }
  previousTime = -Infinity;
  for (const group of groups.values()) {
    if (group.actors.size !== participantCount)
      throw Error("Incomplete reference actor coverage");
    if (group.time < previousTime)
      throw Error("Reference sample clocks move backward");
    previousTime = group.time;
  }
  return {
    groups,
    duration,
    header,
  };
}

function prepareFollowReference(reference, duration, participantCount) {
  const { start, turn, arrival } = reference.reference.cueTimes ?? {};
  const { requestedTimes, samples } = reference;
  if (
    ![start, turn, arrival].every((time) => validTime(time, duration)) ||
    start >= turn ||
    turn >= arrival ||
    requestedTimes.length !== 3 ||
    start !== requestedTimes[0] ||
    turn !== requestedTimes[1] ||
    arrival !== requestedTimes[2]
  )
    throw Error("Invalid continuous follow cue times");
  const followedActorKey = samples[0]?.key;
  if (
    !Number.isInteger(followedActorKey) ||
    followedActorKey < 1 ||
    followedActorKey > participantCount
  )
    throw Error("Invalid continuous follow participant");
  const brackets = [];
  for (const [index, sample] of samples.entries()) {
    const { key, timeBefore, timeAfter, position } = sample ?? {};
    const previous = brackets.at(-1);
    if (
      key !== followedActorKey ||
      !validPosition(position) ||
      !validTime(timeBefore, duration) ||
      !validTime(timeAfter, duration) ||
      timeAfter < timeBefore ||
      timeAfter - timeBefore > maxFollowBracketSeconds ||
      (previous &&
        (timeBefore < previous.timeAfter ||
          (timeBefore === previous.timeBefore &&
            timeAfter === previous.timeAfter) ||
          timeAfter - previous.timeBefore > maxFollowGapSeconds))
    )
      throw Error("Invalid continuous follow sample, clock bracket, or gap");
    const split =
      timeAfter < turn
        ? "calibration"
        : timeBefore >= turn
          ? "held-out"
          : "straddling";
    brackets.push({ index, timeBefore, timeAfter, split, position });
  }
  if (brackets[0].timeAfter > start || brackets.at(-1).timeBefore < arrival)
    throw Error("Continuous follow samples do not cover the cue window");
  return { brackets, followedActorKey, cueTimes: { start, turn, arrival } };
}

/** Build a sampling plan without exposing the comparison positions. */
export function planPositionComparison(identity, reference) {
  const { groups, header, brackets, followedActorKey, cueTimes } =
    prepareReference(identity, reference);
  if (brackets)
    return {
      ...header,
      followedActorKey,
      cueTimes,
      sampleBrackets: brackets.map(
        ({ index, timeBefore, timeAfter, split }) => ({
          index,
          timeBefore,
          timeAfter,
          split,
        }),
      ),
    };
  return {
    ...header,
    sampleTimes: Array.from(
      groups.values(),
      ({ requestedTime, time, split }) => ({ requestedTime, time, split }),
    ),
  };
}

function metric(values) {
  if (values.length === 0) return { max: null, mean: null };
  let max = 0;
  let mean = 0;
  for (const [index, value] of values.entries()) {
    max = Math.max(max, value);
    mean += (value - mean) / (index + 1);
  }
  return { max, mean };
}

function summarize(frames, participantCount) {
  const time = frames.flatMap(({ timeErrorSeconds }) =>
    timeErrorSeconds === null ? [] : [timeErrorSeconds],
  );
  const actors = frames.flatMap(({ actors }) => actors);
  const expectedActors = frames.length * participantCount;
  return {
    expectedFrames: frames.length,
    missingFrames: frames.length - time.length,
    matchedFrames: time.length,
    expectedActors,
    missingActors: expectedActors - actors.length,
    matchedActors: actors.length,
    planarError: metric(actors.map(({ planarError }) => planarError)),
    timeErrorSeconds: metric(time),
  };
}

function positionError(key, position, native) {
  const planarError = Math.hypot(
    position[0] - native[0],
    position[2] - native[2],
  );
  const verticalError = Math.abs(position[1] - native[1]);
  if (!Number.isFinite(planarError) || !Number.isFinite(verticalError))
    throw Error("Decoder position error exceeds the numeric range");
  return { key, planarError, verticalError };
}

function compareFollow(
  decoded,
  { brackets, followedActorKey, cueTimes, duration, header },
) {
  const byIndex = new Map();
  for (const frame of decoded.frames) {
    const { index, time, actors } = frame ?? {};
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= brackets.length ||
      byIndex.has(index) ||
      (time !== null && !validTime(time, duration)) ||
      !Array.isArray(actors) ||
      actors.length > 1 ||
      (actors.length === 1 &&
        (actors[0]?.key !== followedActorKey ||
          !validPosition(actors[0]?.position)))
    )
      throw Error("Invalid or duplicate continuous follow decoder frame");
    byIndex.set(index, frame);
  }
  const frames = brackets.map(({ position, ...bracket }) => {
    const { index, timeBefore, timeAfter } = bracket;
    const frame = byIndex.get(index);
    const decoderTime = frame?.time ?? null;
    const candidate = frame?.actors[0]?.position;
    const timeStatus =
      decoderTime === null
        ? "missing"
        : decoderTime < timeBefore
          ? "before"
          : decoderTime > timeAfter
            ? "after"
            : "matched";
    return {
      ...bracket,
      decoderTime,
      timeStatus,
      missingFrame: frame === undefined,
      bracketErrorSeconds:
        decoderTime === null
          ? null
          : Math.max(0, timeBefore - decoderTime, decoderTime - timeAfter),
      missingActor: Boolean(frame && !candidate),
      actor:
        timeStatus === "matched" && candidate
          ? positionError(followedActorKey, candidate, position)
          : null,
    };
  });
  const summarizeFollow = (split) => {
    const matches = frames.filter((frame) => frame.split === split);
    const scored = matches.flatMap(({ actor }) => (actor ? [actor] : []));
    return {
      expectedFrames: matches.length,
      missingFrames: matches.filter(({ missingFrame }) => missingFrame).length,
      missingTimeFrames: matches.filter(
        ({ missingFrame, timeStatus }) =>
          !missingFrame && timeStatus === "missing",
      ).length,
      outsideBracketFrames: matches.filter(
        ({ timeStatus }) => timeStatus === "before" || timeStatus === "after",
      ).length,
      missingActors: matches.filter(({ missingActor }) => missingActor).length,
      scoredActors: scored.length,
      planarError: metric(scored.map(({ planarError }) => planarError)),
      verticalError: metric(scored.map(({ verticalError }) => verticalError)),
    };
  };
  return {
    ...header,
    followedActorKey,
    cueTimes,
    frames,
    splits: {
      calibration: summarizeFollow("calibration"),
      heldOut: summarizeFollow("held-out"),
      straddling: summarizeFollow("straddling"),
    },
  };
}

export function compareReferencePositions(identity, reference, decoded) {
  const prepared = prepareReference(identity, reference);
  const { groups, duration, header, brackets } = prepared;
  const { participantCount, captureMethod, participantKey } = header;
  requireIdentity(decoded, identity, "Decoder");
  if (
    decoded.captureMethod !== captureMethod ||
    decoded.participantKey !== participantKey ||
    !Array.isArray(decoded.frames)
  )
    throw Error("Invalid decoder capture scope");
  if (brackets) return compareFollow(decoded, prepared);
  const decodedFrames = new Map();
  for (const frame of decoded.frames) {
    const { requestedTime, time, actors } = frame ?? {};
    if (
      !groups.has(requestedTime) ||
      decodedFrames.has(requestedTime) ||
      !validTime(time, duration) ||
      !Array.isArray(actors)
    )
      throw Error("Invalid or duplicate decoder frame");
    const keyed = new Map();
    for (const actor of actors)
      requireActor(keyed, actor, participantCount, "decoder");
    decodedFrames.set(requestedTime, { time, actors: keyed });
  }

  const frames = [];
  for (const group of groups.values()) {
    const { requestedTime, time: nativeTime, split } = group;
    const frame = decodedFrames.get(requestedTime);
    const decoderTime = frame?.time ?? null;
    const timeErrorSeconds =
      decoderTime === null ? null : Math.abs(decoderTime - nativeTime);
    const missingKeys = [];
    const actors = [];
    for (let key = 1; key <= participantCount; key++) {
      const position = frame?.actors.get(key);
      if (!position) {
        missingKeys.push(key);
        continue;
      }
      actors.push(positionError(key, position, group.actors.get(key)));
    }
    frames.push({
      requestedTime,
      split,
      nativeTime,
      decoderTime,
      timeErrorSeconds,
      missingKeys,
      actors,
    });
  }
  return {
    ...header,
    frames,
    splits: {
      calibration: summarize(
        frames.filter(({ split }) => split === "calibration"),
        participantCount,
      ),
      heldOut: summarize(
        frames.filter(({ split }) => split === "held-out"),
        participantCount,
      ),
    },
  };
}
