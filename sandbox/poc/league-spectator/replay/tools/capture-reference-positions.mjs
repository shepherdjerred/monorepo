// Operator-invoked verification against the documented loopback Replay API.
import { createHash, X509Certificate } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { zstdDecompressSync } from "node:zlib";
import { buildReplayKeyframeIndex } from "../replay-keyframe-index.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";
import {
  captureContinuousFollow,
  captureReferencePositions,
} from "./research/reference-position-samples.mjs";

const usage =
  "Usage: node capture-reference-positions.mjs --confirm-loaded-replay <replay.rofl> <output.json> <seconds[,seconds...]> [--seek-snapshots | --follow-actor <footer-row> [--follow-from <seconds>]] [certificate and duration options]\nOr replace the seconds with --keyframes <ordinal[,ordinal...]> --seek-snapshots. Keyframe ordinals start at 1.\nCertificate and duration options: [--ca <riotgames.pem>] [--expected-client-length <seconds>]\nFollow mode requires three times in seconds: start,turn,arrival. By default playback starts at zero. --follow-from starts 1x playback after settling a paused seek to a clock earlier than start, with anchor provenance in the receipt.";

const decompress = (input, destination) =>
  zstdDecompressSync(input, { maxOutputLength: destination.length });

export function resolveReplayKeyframeTimes(replay, argument) {
  const tokens = argument.split(",");
  const ordinals = tokens.map(Number);
  if (
    tokens.length > 32 ||
    tokens.some((token) => !/^[1-9]\d*$/.test(token)) ||
    ordinals.some(
      (ordinal, index) =>
        !Number.isSafeInteger(ordinal) ||
        (index > 0 && ordinal <= ordinals[index - 1]),
    )
  )
    throw Error(
      "Enter up to 32 strictly increasing one-based keyframe ordinals",
    );

  const keyframes = buildReplayKeyframeIndex(replay, decompress);
  if (ordinals.at(-1) > keyframes.length)
    throw Error(`Replay has ${keyframes.length} indexed keyframes`);
  return {
    ordinals,
    times: ordinals.map((ordinal) => keyframes[ordinal - 1].timeSeconds),
  };
}

export function validateLoadedReplayLength(
  playback,
  footerSeconds,
  confirmedClientSeconds,
) {
  const expectedSeconds = confirmedClientSeconds ?? footerSeconds;
  if (
    !Number.isFinite(playback.length) ||
    Math.abs(playback.length - expectedSeconds) > 0.01
  )
    throw Error(
      confirmedClientSeconds === undefined
        ? "Loaded replay duration differs from the local replay footer"
        : "Loaded replay duration differs from the explicitly expected client length",
    );
}

export function validateCapturedSampleTimes(samples, footerSeconds, method) {
  for (const sample of samples) {
    const times =
      method === "continuous-follow"
        ? [sample.timeBefore, sample.timeAfter]
        : [sample.time];
    if (
      times.some(
        (time) => !Number.isFinite(time) || time < 0 || time > footerSeconds,
      )
    )
      throw Error(
        "Reference sample clock is outside the replay footer duration",
      );
  }
}

export function requestApi(ca, path, body) {
  if (!["game", "recording", "playback", "render"].includes(path))
    throw Error("Unsupported Replay API resource");
  const input = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      `https://127.0.0.1:2999/replay/${path}`,
      {
        method: input === undefined ? "GET" : "POST",
        ca,
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(5000),
        headers:
          input === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(input),
              },
      },
      async (response) => {
        try {
          if (response.statusCode !== 200) {
            response.destroy();
            reject(
              Error(`Replay API ${path} returned HTTP ${response.statusCode}`, {
                cause: { statusCode: response.statusCode },
              }),
            );
            return;
          }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response) {
            bytes += chunk.length;
            if (bytes > 64 * 1024)
              throw Error("Replay API response exceeds 64 KiB");
            chunks.push(chunk);
          }
          resolve(JSON.parse(Buffer.concat(chunks)));
        } catch (cause) {
          response.destroy();
          reject(Error(`Invalid Replay API response from ${path}`, { cause }));
        }
      },
    );
    req.on("error", (cause) =>
      reject(
        Error(
          `Replay API ${path} request failed (${cause.code ?? cause.name})`,
          { cause },
        ),
      ),
    );
    req.end(input);
  });
}

async function main([
  confirmation,
  replayPath,
  outputPath,
  sampleArgument,
  ...options
]) {
  if (
    confirmation !== "--confirm-loaded-replay" ||
    !replayPath ||
    !outputPath ||
    !sampleArgument
  )
    throw Error(usage);
  const byKeyframe = sampleArgument === "--keyframes";
  const sampleList = byKeyframe ? options.shift() : sampleArgument;
  if (!sampleList || sampleList.startsWith("--")) throw Error(usage);
  const settings = new Map();
  for (let index = 0; index < options.length; index++) {
    const flag = options[index];
    if (settings.has(flag)) throw Error(usage);
    if (flag === "--seek-snapshots") {
      settings.set(flag, true);
      continue;
    }
    const value = options[++index];
    if (
      ![
        "--ca",
        "--expected-client-length",
        "--follow-actor",
        "--follow-from",
      ].includes(flag) ||
      !value ||
      value.startsWith("--")
    )
      throw Error(usage);
    settings.set(flag, value);
  }
  const followRow = settings.get("--follow-actor");
  const rawAnchor = settings.get("--follow-from");
  const followFrom = rawAnchor === undefined ? undefined : Number(rawAnchor);
  if (
    followFrom !== undefined &&
    (followRow === undefined ||
      !/^\d+(?:\.\d+)?$/.test(rawAnchor) ||
      !Number.isFinite(followFrom))
  )
    throw Error(usage);
  if (
    byKeyframe &&
    (!settings.has("--seek-snapshots") || followRow !== undefined)
  )
    throw Error(usage);
  const rawClientLength = settings.get("--expected-client-length");
  const confirmedClientSeconds =
    rawClientLength === undefined ? undefined : Number(rawClientLength);
  if (
    confirmedClientSeconds !== undefined &&
    (!/^\d+(?:\.\d+)?$/.test(rawClientLength) ||
      !Number.isFinite(confirmedClientSeconds) ||
      confirmedClientSeconds <= 0)
  )
    throw Error("Expected client length must be a positive number of seconds");

  const bytes = await readFile(replayPath).catch((cause) => {
    throw Error(`Could not read replay input (${cause.code ?? cause.name})`);
  });
  let replay;
  try {
    replay = openReplay(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  } catch {
    throw Error(
      "Input is not a valid ROFL v2 replay with participant metadata",
    );
  }
  const replaySha256 = createHash("sha256").update(bytes).digest("hex");
  const selection = byKeyframe
    ? resolveReplayKeyframeTimes(replay, sampleList)
    : null;
  const tokens = sampleList.split(",");
  const times = selection?.times ?? tokens.map(Number);
  if (
    followRow !== undefined &&
    (settings.has("--seek-snapshots") ||
      !/^(?:[1-9]|10)$/.test(followRow) ||
      times.length !== 3)
  )
    throw Error(usage);
  if (followFrom !== undefined && followFrom >= times[0])
    throw Error("--follow-from must be earlier than the movement window start");
  if (
    !Number.isSafeInteger(replay.durationMilliseconds) ||
    tokens.length > 32 ||
    (!byKeyframe && tokens.some((token) => !/^\d+(?:\.\d+)?$/.test(token))) ||
    times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time >= replay.duration ||
        (index > 0 && time <= times[index - 1]),
    )
  )
    throw Error(
      "Enter up to 32 strictly increasing sample times inside the replay",
    );

  const participants = replay.playerIdentities.map((identity, index) => ({
    key: index + 1,
    selectionName: identity?.gameName,
  }));
  if (
    participants.length !== 10 ||
    replay.roster.filter(({ team }) => team === 100).length !== 5 ||
    replay.roster.filter(({ team }) => team === 200).length !== 5 ||
    participants.some(({ selectionName }) => !selectionName?.trim()) ||
    new Set(
      participants.map(({ selectionName }) => selectionName.toLowerCase()),
    ).size !== participants.length
  )
    throw Error("Replay must provide two teams and ten unique selection names");

  if (!byKeyframe) {
    for (const unused of replayPacketEnvelopes(replay, decompress)) {
      // Require the exact build/protocol and every declared chunk to validate.
    }
  }
  const output = resolve(outputPath);
  await access(dirname(output)).catch((cause) => {
    throw Error(
      `Cannot access evidence output directory (${cause.code ?? cause.name})`,
    );
  });
  try {
    await access(output);
    throw Error("Choose an output file that does not already exist");
  } catch (error) {
    if (!error.code) throw error;
    if (error.code !== "ENOENT")
      throw Error(`Cannot access evidence output (${error.code})`);
  }
  let ca;
  if (settings.has("--ca")) {
    try {
      ca = await readFile(settings.get("--ca"));
      ca = new X509Certificate(ca).toString();
    } catch {
      throw Error(
        "The --ca file must contain a readable Riot Game Client certificate",
      );
    }
  }

  const api = (path, body) => requestApi(ca, path, body);
  const { processID } = await api("game");
  if (!Number.isSafeInteger(processID) || processID <= 0)
    throw Error("The Replay API did not report a valid game process");
  if ((await api("recording")).recording !== false)
    throw Error("The Replay API must report that no recording is active");
  const playback = await api("playback");
  validateLoadedReplayLength(playback, replay.duration, confirmedClientSeconds);

  const pinnedApi = async (path, body) => {
    if (body !== undefined && (await api("game")).processID !== processID)
      throw Error("The game process changed before a capture write");
    return api(path, body);
  };
  const method =
    followRow !== undefined
      ? "continuous-follow"
      : settings.has("--seek-snapshots")
        ? "paused-seek"
        : "continuous";
  let anchor;
  const samples =
    method === "continuous-follow"
      ? await captureContinuousFollow({
          api: pinnedApi,
          participant: participants[Number(followRow) - 1],
          times,
          followFrom,
          onAnchor: (value) => {
            anchor = value;
          },
          delay,
        })
      : await captureReferencePositions({
          api: pinnedApi,
          participants,
          times,
          method,
          delay,
        });
  validateCapturedSampleTimes(samples, replay.duration, method);
  if ((await api("game")).processID !== processID)
    throw Error("The game process changed during capture");

  const result = {
    schemaVersion: 1,
    purpose: "local-verification-only",
    build: replay.build,
    protocol: replay.protocol,
    durationMilliseconds: replay.durationMilliseconds,
    replaySha256,
    reference: {
      source: "riot-replay-api-camera-attachment",
      processID,
      replayIdentity: "operator-confirmed",
      replayDigestAttestedByApi: false,
      captureMethod: method,
      ...(selection && { requestedKeyframeOrdinals: selection.ordinals }),
      ...(method === "paused-seek" && {
        scope:
          "Seek-state observations only. Motion controllers may differ from continuous playback.",
      }),
      ...(method === "continuous-follow" && {
        scope:
          followFrom === undefined
            ? "One actor during unpaused 1x playback from zero. Playback reads bracket each camera observation."
            : "One actor during unpaused 1x playback after a paused seek. Playback reads bracket each camera observation.",
        ...anchor,
        cueTimes: { start: times[0], turn: times[1], arrival: times[2] },
      }),
      loadedDurationSeconds: playback.length,
      expectedClientDurationSeconds: confirmedClientSeconds ?? null,
      participantKey: "one-based-rofl-footer-row",
    },
    requestedTimes: times,
    samples,
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  }).catch((cause) => {
    throw Error(
      `Could not write evidence output (${cause.code ?? cause.name})`,
    );
  });
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
