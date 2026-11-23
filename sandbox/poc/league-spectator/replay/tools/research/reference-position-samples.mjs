// Local research only. The caller supplies the Replay API and roster binding.
const axes = ["x", "y", "z"];
const offset = { x: 0, y: 1600, z: -1100 };

const defaultDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function attached(render, name) {
  return (
    render.cameraAttached === true &&
    typeof render.selectionName === "string" &&
    render.selectionName.toLowerCase() === name.toLowerCase() &&
    axes.every(
      (axis) =>
        Number.isFinite(render.cameraPosition?.[axis]) &&
        render.selectionOffset?.[axis] === offset[axis],
    )
  );
}

function stableAttachment(first, second, selectionName) {
  return (
    attached(first, selectionName) &&
    attached(second, selectionName) &&
    axes.every(
      (axis) => first.cameraPosition[axis] === second.cameraPosition[axis],
    )
  );
}

function attach(api, selectionName) {
  return api("render", {
    cameraMode: "fps",
    cameraAttached: true,
    selectionName,
    selectionOffset: { ...offset },
  });
}

function position(render) {
  return axes.map((axis) => render.cameraPosition[axis] - offset[axis]);
}

async function waitForSeek(api, delay, expectedTime) {
  for (let attempt = 0; attempt <= 200; attempt++) {
    const playback = await api("playback");
    if (
      playback.seeking === false &&
      (expectedTime === undefined || pausedAt(playback, expectedTime))
    )
      return playback;
    if (attempt < 200) await delay(100);
  }
  throw Error("Reference seek did not settle");
}

function pausedAt(state, seconds) {
  return (
    state.paused === true &&
    state.seeking === false &&
    Number.isFinite(state.time) &&
    Math.abs(state.time - seconds) <= 0.002
  );
}

async function restoreView(api, delay, playback, render) {
  const failures = [];
  const renderFields = [
    "cameraMode",
    "cameraAttached",
    "selectionName",
    "selectionOffset",
    "cameraPosition",
    "cameraRotation",
  ];
  const renderSettings = Object.fromEntries(
    renderFields
      .filter((field) => Object.hasOwn(render, field))
      .map((field) => [field, render[field]]),
  );
  const operations = [
    async () => {
      await api("playback", {
        paused: true,
        time: playback.time,
        speed: playback.speed,
      });
      await waitForSeek(api, delay);
    },
    () => api("render", renderSettings),
  ];
  if (!playback.paused)
    operations.push(() => api("playback", { paused: false }));
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function captureReferencePositions({
  api,
  participants,
  times,
  method = "continuous",
  delay = defaultDelay,
}) {
  if (!["continuous", "paused-seek"].includes(method))
    throw Error("Unsupported reference capture method");
  if (
    !participants.length ||
    participants.some(
      ({ key, selectionName }) =>
        !(
          (typeof key === "string" && key.length > 0) ||
          Number.isSafeInteger(key)
        ) ||
        typeof selectionName !== "string" ||
        !selectionName.trim(),
    ) ||
    new Set(participants.map(({ key }) => key)).size !== participants.length ||
    new Set(
      participants.map(({ selectionName }) => selectionName.toLowerCase()),
    ).size !== participants.length
  )
    throw Error("Reference capture requires unique participant keys and names");
  if (
    !times.length ||
    times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time < 0 ||
        (index > 0 && time <= times[index - 1]),
    )
  )
    throw Error(
      "Reference capture requires ascending, nonnegative sample times",
    );

  return withReferenceView(api, delay, async (originalPlayback) => {
    const observations = [];
    let playback = originalPlayback;
    if (method === "continuous") {
      await api("playback", { paused: true, time: 0, speed: 1 });
      playback = await waitForSeek(api, delay, 0);
    }
    for (const requestedTime of times) {
      if (method === "paused-seek") {
        await api("playback", { paused: true, time: requestedTime, speed: 1 });
        playback = await waitForSeek(api, delay, requestedTime);
      } else if (playback.time < requestedTime) {
        // Forward playback preserves motion controllers between sample times.
        const attempts = Math.ceil((requestedTime - playback.time) * 20) + 200;
        await api("playback", { paused: false, speed: 1 });
        for (let attempt = 0; attempt < attempts; attempt++) {
          await delay(50);
          playback = await api("playback");
          if (playback.time >= requestedTime) break;
        }
        playback = await api("playback", { paused: true });
      }
      const observedTime = playback.time;
      if (
        method === "continuous" &&
        (!pausedAt(playback, observedTime) ||
          observedTime < requestedTime ||
          observedTime - requestedTime > 0.5)
      )
        throw Error(`Reference playback did not pause near ${requestedTime}`);
      const sampleTime =
        method === "paused-seek" ? requestedTime : observedTime;
      for (const { key, selectionName } of participants) {
        await attach(api, selectionName);
        await delay(150);
        const first = await api("render");
        const firstPlayback = await api("playback");
        await delay(60);
        const second = await api("render");
        playback = await api("playback");
        if (
          !stableAttachment(first, second, selectionName) ||
          !pausedAt(firstPlayback, sampleTime) ||
          !pausedAt(playback, sampleTime) ||
          !pausedAt(playback, firstPlayback.time)
        )
          throw Error(`Unstable reference attachment at ${requestedTime}`);
        observations.push({
          key,
          requestedTime,
          time: playback.time,
          position: position(second),
        });
      }
    }
    return observations;
  });
}

async function withReferenceView(api, delay, capture) {
  const originalRender = await api("render");
  const originalPlayback = await api("playback");
  if (
    typeof originalPlayback.paused !== "boolean" ||
    originalPlayback.seeking !== false ||
    !Number.isFinite(originalPlayback.time) ||
    !Number.isFinite(originalPlayback.speed)
  )
    throw Error("Original reference playback state is invalid or seeking");

  let captureError;
  try {
    return await capture(originalPlayback);
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    const failures = await restoreView(
      api,
      delay,
      originalPlayback,
      originalRender,
    );
    if (failures.length)
      throw new AggregateError(
        captureError ? [captureError, ...failures] : failures,
        captureError
          ? `${captureError.message}; reference view restoration failed`
          : "Reference view restoration failed",
        { cause: captureError ?? failures[0] },
      );
  }
}

function checkForwardPlayback(playback) {
  if (
    playback.paused !== false ||
    playback.seeking !== false ||
    playback.speed !== 1 ||
    !Number.isFinite(playback.time) ||
    playback.time < 0
  )
    throw Error(
      "Continuous reference playback stopped, sought, or changed rate",
    );
}

export const maxFollowGapSeconds = 0.2;
export const maxFollowBracketSeconds = 0.1;

export async function captureContinuousFollow({
  api,
  participant,
  times,
  followFrom,
  onAnchor,
  delay = defaultDelay,
}) {
  const [start, turn, arrival] = times;
  if (
    times.length !== 3 ||
    !times.every(Number.isFinite) ||
    !(0 <= start && start < turn && turn < arrival) ||
    !Number.isSafeInteger(participant?.key) ||
    typeof participant.selectionName !== "string" ||
    !participant.selectionName.trim()
  )
    throw Error(
      "Continuous follow requires one participant and ascending start, turn, and arrival times",
    );

  if (
    followFrom !== undefined &&
    (!Number.isFinite(followFrom) || followFrom < 0 || followFrom >= start)
  )
    throw Error(
      "Continuous follow anchor must be earlier than the window start",
    );
  const anchor = followFrom ?? 0;
  const { key, selectionName } = participant;
  return withReferenceView(api, delay, async () => {
    await api("playback", { paused: true, time: anchor, speed: 1 });
    await waitForSeek(api, delay, anchor);
    await attach(api, selectionName);
    await delay(150);
    const first = await api("render");
    await delay(60);
    const initial = await api("render");
    const settled = await api("playback");
    if (
      !stableAttachment(first, initial, selectionName) ||
      !pausedAt(settled, anchor)
    )
      throw Error("Could not establish a stable initial follow attachment");
    onAnchor?.({
      startMode: followFrom === undefined ? "from-zero" : "paused-seek",
      requestedAnchorSeconds: anchor,
      observedAnchorSeconds: settled.time,
    });

    const samples =
      start === 0
        ? [{ key, timeBefore: 0, timeAfter: 0, position: position(initial) }]
        : [];
    await api("playback", { paused: false, speed: 1 });
    const attempts = Math.ceil((arrival - anchor) * 50) + 500;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const before = await api("playback");
      checkForwardPlayback(before);
      if (before.time < start - maxFollowGapSeconds / 2) {
        await delay(20);
        continue;
      }
      const render = await api("render");
      const after = await api("playback");
      checkForwardPlayback(after);
      if (!attached(render, selectionName))
        throw Error("Continuous reference camera attachment changed");
      if (
        after.time < before.time ||
        after.time - before.time > maxFollowBracketSeconds
      )
        throw Error(
          "Continuous reference sample clock bracket is invalid or too wide",
        );

      const previous = samples.at(-1);
      if (!previous && after.time > start)
        throw Error(
          "Continuous reference sampling missed the start of the window",
        );
      if (
        previous &&
        (before.time < previous.timeAfter ||
          after.time - previous.timeBefore > maxFollowGapSeconds)
      )
        throw Error("Continuous reference sample gap or clock regression");
      if (
        !previous ||
        before.time > previous.timeBefore ||
        after.time > previous.timeAfter
      )
        samples.push({
          key,
          timeBefore: before.time,
          timeAfter: after.time,
          position: position(render),
        });
      if (before.time >= arrival) return samples;
      await delay(20);
    }
    throw Error(
      "Continuous reference playback did not cover the movement window",
    );
  });
}
