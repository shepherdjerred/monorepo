import { createHash, X509Certificate } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openReplay } from "../transport.mjs";
import {
  requestApi,
  validateLoadedReplayLength,
} from "./capture-reference-positions.mjs";
import {
  mediaDigest,
  readMediaMetadata,
} from "./verify-native-recording-metadata.mjs";

const usage =
  "Usage: node capture-native-replay-av.mjs --confirm-loaded-replay <replay.rofl> <new-output-directory> [--ca <riotgames.pem>] [--expected-client-length <seconds>] [--window <start,end>]";
const fps = 60;
const clockTolerance = 0.01;
const near = (value, expected) =>
  Number.isFinite(value) && Math.abs(value - expected) <= clockTolerance;
const printClock = (value) =>
  Number.isFinite(value) ? value.toFixed(6) : "unavailable";

export function recordingWindow(argument, durationSeconds, clientSeconds) {
  const parts = argument?.split(",");
  if (
    parts &&
    (parts.length !== 2 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)))
  )
    throw Error("Enter a start and end time in seconds");
  const [startSeconds, endSeconds] = parts
    ? parts.map(Number)
    : [0, durationSeconds];
  if (
    !Number.isFinite(endSeconds) ||
    !(startSeconds < endSeconds) ||
    endSeconds > durationSeconds ||
    endSeconds > clientSeconds
  )
    throw Error(
      "Recording window must be inside both replay and client durations",
    );
  return { startSeconds, endSeconds };
}

function statusPath(path, directory) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    dirname(resolve(path)) !== directory ||
    extname(path).toLowerCase() !== ".webm"
  )
    return null;
  return resolve(path);
}

async function stopOwnedRecording(api, processID, directory, mediaPath) {
  if ((await api("game"))?.processID !== processID) return;
  const status = await api("recording");
  if (status?.recording === false) return;
  if (status?.recording !== true)
    throw Error("The Replay API did not report a valid recording status");
  const activePath = statusPath(status.path, directory);
  if (!activePath || (mediaPath && activePath !== mediaPath)) return;
  if ((await api("game"))?.processID !== processID) return;
  if ((await api("recording", { recording: false }))?.recording !== false)
    throw Error("The Replay API did not acknowledge that recording stopped");
}

export async function captureNativeReplayAv({
  api,
  outputPath,
  identity,
  expectedClientSeconds,
  windowArgument,
  wait = delay,
  now = () => performance.now(),
  inspect = readMediaMetadata,
}) {
  const output = resolve(outputPath);
  const directory = resolve(await realpath(dirname(output)), basename(output));
  const assertIdle = async () => {
    if ((await api("recording"))?.recording !== false)
      throw Error("The Replay API must report that no recording is active");
  };
  let game;
  try {
    game = await api("game");
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED" || error.code === "ECONNREFUSED")
      throw Error(
        "Native Replay API is unavailable at 127.0.0.1:2999. Open the exact replay with the Replay API enabled.",
        { cause: error },
      );
    throw error;
  }
  const processID = game?.processID;
  if (!Number.isSafeInteger(processID) || processID <= 0)
    throw Error("The Replay API did not report a valid game process");
  const assertSameProcess = async () => {
    if ((await api("game"))?.processID !== processID)
      throw Error("The game process changed during native capture");
  };
  const durationSeconds = identity.durationMilliseconds / 1000;
  const readPlaybackLength = async () => {
    const playback = await api("playback");
    validateLoadedReplayLength(
      playback,
      durationSeconds,
      expectedClientSeconds,
    );
    return playback.length;
  };
  await assertIdle();
  const loadedDurationSeconds = await readPlaybackLength();
  const window = recordingWindow(
    windowArgument,
    durationSeconds,
    loadedDurationSeconds,
  );
  const { startSeconds, endSeconds } = window;
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error.code === "EEXIST")
      throw Error("Choose a capture directory that does not already exist");
    throw error;
  });

  await assertSameProcess();
  const playback = await api("playback", { paused: false, speed: 1 });
  validateLoadedReplayLength(playback, durationSeconds, expectedClientSeconds);
  if (playback.paused !== false || playback.speed !== 1)
    throw Error("The Replay API did not acknowledge 1× playback");
  await assertIdle();
  await assertSameProcess();
  const started = now();

  let mediaPath;
  let firstRecordingTime;
  let lastRecordingTime;
  let activeObservations = 0;
  const observeSettings = (status, completed = false) => {
    if (
      !near(status.startTime, startSeconds) ||
      (!near(status.endTime, endSeconds) &&
        !(completed && status.endTime === -1)) ||
      status.codec !== "webm" ||
      status.framesPerSecond !== fps ||
      status.replaySpeed !== 1 ||
      status.enforceFrameRate !== true
    )
      throw Error("The Replay API reported inconsistent recording settings");
    const reportedPath = statusPath(status.path, directory);
    if (!reportedPath)
      throw Error(
        "The Replay API reported a WebM path outside the new capture directory",
      );
    if (mediaPath && reportedPath !== mediaPath)
      throw Error("The recording output changed during capture");
    mediaPath = reportedPath;
  };
  const observeActive = (status) => {
    observeSettings(status);
    if (
      !Number.isFinite(status.currentTime) ||
      status.currentTime < 0 ||
      status.currentTime > endSeconds + clockTolerance ||
      (lastRecordingTime !== undefined &&
        status.currentTime < lastRecordingTime - clockTolerance)
    )
      throw Error(
        `The Replay API reported an inconsistent active recording clock (current ${printClock(status.currentTime)} s, previous in-window ${printClock(lastRecordingTime)} s, requested ${startSeconds}–${endSeconds} s)`,
      );
    // The recorder first seeks and advances the replay toward startTime. Its
    // active flag can already be set while that clock is before the window.
    if (status.currentTime < startSeconds - clockTolerance) return;
    firstRecordingTime ??= status.currentTime;
    lastRecordingTime = status.currentTime;
    activeObservations++;
  };
  try {
    const startStatus = await api("recording", {
      recording: true,
      codec: "webm",
      path: directory,
      startTime: startSeconds,
      endTime: endSeconds,
      framesPerSecond: fps,
      enforceFrameRate: true,
    });
    // League Director reports the produced file path in the active status.
    for (let status = startStatus; ; status = await api("recording")) {
      await assertSameProcess();
      if (status?.recording === true) {
        observeActive(status);
      } else if (status?.recording !== false) {
        throw Error("The Replay API did not report a valid recording status");
      } else if (activeObservations > 0) {
        if (status.path) {
          // Native natural completion resets endTime while the playback clock
          // may already have advanced beyond the last recorded frame.
          observeSettings(status, true);
          if (
            !Number.isFinite(status.currentTime) ||
            status.currentTime <
              (status.endTime === -1 ? endSeconds : lastRecordingTime) -
                clockTolerance ||
            status.currentTime > loadedDurationSeconds + clockTolerance
          )
            throw Error(
              `The Replay API reported an inconsistent completed recording clock (current ${printClock(status.currentTime)} s, previous in-window ${printClock(lastRecordingTime)} s, reported end ${printClock(status.endTime)} s)`,
            );
        }
        break;
      } else if (now() - started > 5000) {
        throw Error("The Replay API did not start the recording");
      }
      if (now() - started > (endSeconds - startSeconds) * 4000 + 120_000)
        throw Error(
          "The Replay API did not finish the recording before timeout",
        );
      await wait(250);
    }
  } catch (error) {
    try {
      await stopOwnedRecording(api, processID, directory, mediaPath);
    } catch (cleanupError) {
      throw Error(
        `${error.message}. Recording cleanup failed: ${cleanupError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
  if (
    activeObservations < 2 ||
    firstRecordingTime > startSeconds + 1 ||
    lastRecordingTime < endSeconds - 1 ||
    !(lastRecordingTime > firstRecordingTime)
  )
    throw Error(
      "Native recording progress did not reach the requested window boundaries",
    );
  await readPlaybackLength();
  await assertSameProcess();
  const media = await lstat(mediaPath);
  if (
    !media.isFile() ||
    media.size === 0 ||
    (await realpath(mediaPath)) !== mediaPath
  )
    throw Error("The recording did not produce a nonempty local WebM");
  const mediaSha256 = await mediaDigest(mediaPath);
  const metadata = await inspect(mediaPath);
  if ((await mediaDigest(mediaPath)) !== mediaSha256)
    throw Error("The WebM changed during inspection");

  // Check the length of each track independently. A reviewed clock anchor
  // is still needed to verify the shared time interval.
  const minimumSpan = endSeconds - startSeconds - 2 / fps;
  for (const kind of ["audio", "video"]) {
    const matches = metadata.tracks.filter((track) => track.kind === kind);
    if (matches.length !== 1)
      throw Error(`Expected one ${kind} track in the native recording`);
    const [track] = matches;
    if (
      track.packets === 0 ||
      track.packetsWithoutPts !== 0 ||
      !Number.isFinite(track.startPtsSeconds) ||
      !Number.isFinite(track.endPtsSeconds) ||
      track.endPtsSeconds - track.startPtsSeconds < minimumSpan
    )
      throw Error(
        `Native recording ${kind} packet timestamps do not span the requested duration`,
      );
  }
  const result = {
    schemaVersion: 1,
    purpose: "local-verification-only",
    ...identity,
    mediaFile: basename(mediaPath),
    mediaSha256,
    reference: {
      source: "riot-replay-api-recording",
      processID,
      replayIdentity: "operator-confirmed",
      replayDigestAttestedByApi: false,
      operatorReviewed: false,
      playbackRate: 1,
      loadedDurationSeconds,
      expectedClientDurationSeconds: expectedClientSeconds ?? null,
    },
    window,
    mediaClockAnchor: null,
    recordingProgress: {
      firstRecordingTime,
      lastRecordingTime,
      activeObservations,
    },
    metadata,
  };
  await writeFile(
    resolve(directory, "capture.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return result;
}

async function main([confirmation, replayPath, outputPath, ...options]) {
  if (confirmation !== "--confirm-loaded-replay" || !replayPath || !outputPath)
    throw Error(usage);
  const settings = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const flag = options[index];
    const value = options[index + 1];
    if (
      !["--ca", "--expected-client-length", "--window"].includes(flag) ||
      settings.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      throw Error(usage);
    settings.set(flag, value);
  }
  const rawClientLength = settings.get("--expected-client-length");
  const expectedClientSeconds =
    rawClientLength === undefined ? undefined : Number(rawClientLength);
  if (
    rawClientLength !== undefined &&
    (!/^\d+(?:\.\d+)?$/.test(rawClientLength) ||
      !Number.isFinite(expectedClientSeconds) ||
      expectedClientSeconds <= 0)
  )
    throw Error("Expected client length must be a positive number of seconds");
  const bytes = new Uint8Array(await readFile(replayPath));
  const { build, protocol, durationMilliseconds } = openReplay(bytes.buffer);
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0)
    throw Error("The replay footer must contain a positive duration");
  const replaySha256 = createHash("sha256").update(bytes).digest("hex");
  let ca;
  if (settings.has("--ca"))
    ca = new X509Certificate(await readFile(settings.get("--ca"))).toString();
  return captureNativeReplayAv({
    api: (path, body) => requestApi(ca, path, body),
    outputPath,
    identity: { build, protocol, durationMilliseconds, replaySha256 },
    expectedClientSeconds,
    windowArgument: settings.get("--window"),
  });
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
