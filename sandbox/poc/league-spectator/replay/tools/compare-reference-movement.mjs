// Research validation only. The browser viewer never calls the installed game.
// Uses Riot's Replay API camera attachment as an observable world-position probe.
import { resolve } from "node:path";
import { openReplay } from "../transport.mjs";
import { sampleMovement } from "../playback.mjs";
import { prepareLatestMovement } from "../latest-movement.mjs";

const [replayPath, reportPath, manifestPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun compare-reference-movement.mjs <replay.rofl> <reconstruction.json> <scene-manifest.json> <output.json>",
  );
const bytes = await Bun.file(replayPath).arrayBuffer(),
  replay = openReplay(bytes),
  report = await Bun.file(reportPath).json(),
  manifest = await Bun.file(manifestPath).json(),
  replaySha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const footer = new DataView(bytes),
  metadataLength = footer.getUint32(bytes.byteLength - 4, true),
  metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(
        bytes,
        bytes.byteLength - 4 - metadataLength,
        metadataLength,
      ),
    ),
  ),
  participants = JSON.parse(metadata.statsJson),
  playerNames = participants.map((player) => player.RIOT_ID_GAME_NAME);
if (
  playerNames.some((name) => typeof name !== "string" || !name.length) ||
  new Set(playerNames.map((name) => name.toLowerCase())).size !==
    report.heroes.length
)
  throw Error("Reference API requires unambiguous recorded player names");
if (
  replay.build !== manifest.build ||
  replay.build !== report.build ||
  replay.protocol !== manifest.protocol ||
  replaySha256 !== report.replaySha256 ||
  report.referenceMovementVerified !== false
)
  throw Error(
    "Reference inputs disagree or are already modified by reference data",
  );
const movement = prepareLatestMovement(report, manifest.map),
  tracks = movement.tracks,
  baselineTracks = prepareLatestMovement(
    {
      ...report,
      movement: report.movement.filter((record) => record.opcode === 657),
    },
    manifest.map,
  ).tracks;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body) {
  const response = await fetch(`https://127.0.0.1:2999/replay/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // The documented game API presents a local self-signed certificate.
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error(`Replay API ${path}: HTTP ${response.status}`);
  return response.json();
}
const game = await api("game"),
  originalRender = await api("render"),
  originalPlayback = await api("playback");
if (!game.processID || (await api("recording")).recording)
  throw Error("No game process, or another recording is active");
const offset = { x: 0, y: 1600, z: -1100 },
  observations = [],
  times = [10, 30, 31, 44, 51, 60, 61, 68.13, 71.2, 90, 103, 119].filter(
    (time) => time < report.endTime,
  );
try {
  await api("playback", { paused: true, time: 0, speed: 1 });
  const seekDeadline = Date.now() + 20000;
  while ((await api("playback")).seeking) {
    if (Date.now() > seekDeadline)
      throw Error("Initial reference seek did not settle");
    await delay(100);
  }
  for (const time of times) {
    // Run forward at 1x from zero. Seeking into a motion event can restart its
    // controller at the snapshot clock and produce a different native position.
    const before = await api("playback"),
      deadline = Date.now() + (time - before.time) * 1000 + 10000;
    await api("playback", { paused: false, speed: 1 });
    let playback;
    do {
      await delay(50);
      playback = await api("playback");
      if (Date.now() > deadline)
        throw Error(`Reference playback did not reach ${time}`);
    } while (playback.time < time);
    playback = await api("playback", { paused: true });
    const observedTime = playback.time;
    // Seeking clears game selections; attach only after the seek has finished.
    for (const hero of report.heroes) {
      const playerName = playerNames[hero.slot - 1];
      if (participants[hero.slot - 1].SKIN !== hero.champion)
        throw Error("Native reference roster binding disagrees");
      await api("render", {
        cameraMode: "fps",
        cameraAttached: true,
        selectionName: playerName,
        selectionOffset: offset,
      });
      await delay(150);
      const first = await api("render");
      await delay(60);
      const render = await api("render"),
        state = await api("playback");
      if (
        !render.cameraAttached ||
        render.selectionName.toLowerCase() !== playerName.toLowerCase() ||
        state.seeking ||
        !state.paused ||
        Math.abs(state.time - observedTime) > 0.002 ||
        observedTime < time ||
        observedTime - time > 0.5 ||
        JSON.stringify(first.cameraPosition) !==
          JSON.stringify(render.cameraPosition)
      )
        throw Error(
          `Unstable reference attachment: ${hero.champion} at ${time}`,
        );
      const nativePosition = ["x", "y", "z"].map(
        (axis) => render.cameraPosition[axis] - render.selectionOffset[axis],
      );
      const sampled = sampleMovement(tracks.get(hero.entityId), state.time);
      if (!sampled) {
        observations.push({
          champion: hero.champion,
          entityId: hero.entityId,
          time: state.time,
          nativePosition,
          status: "no-reconstructed-path-yet",
        });
        continue;
      }
      const residual = [
        sampled.point[0] - nativePosition[0],
        sampled.point[1] - nativePosition[2],
      ];
      const baseline = sampleMovement(
          baselineTracks.get(hero.entityId),
          state.time,
        ),
        baselineDistance = Math.hypot(
          baseline.point[0] - nativePosition[0],
          baseline.point[1] - nativePosition[2],
        );
      observations.push({
        champion: hero.champion,
        entityId: hero.entityId,
        time: state.time,
        nativePosition,
        nativeSelectionMatchesRecordedPlayer: true,
        reconstructedPosition: sampled.point,
        residual,
        distance: Math.hypot(...residual),
        baselinePosition: baseline.point,
        baselineDistance,
        pathTime: sampled.event.time,
        source: sampled.event.source,
        moving: sampled.moving,
      });
    }
    console.log(JSON.stringify({ time, observed: observations.length }));
  }
} finally {
  // Keep the replay paused, and restore the user's rendering configuration.
  await api("playback", {
    paused: true,
    time: originalPlayback.time,
    speed: originalPlayback.speed,
  });
  await api("render", originalRender);
}
const distances = observations
    .filter((v) => v.distance !== undefined)
    .map((v) => v.distance)
    .sort((a, b) => a - b),
  percentile = (p) =>
    distances[Math.min(distances.length - 1, Math.floor(distances.length * p))];
const output = {
  schema: 1,
  method:
    "Continuous forward playback at 1x from zero; pause at sampled times, attach by the recorded player name, and subtract the explicit selection offset",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  processID: game.processID,
  movementOrigin: manifest.map.movementOrigin,
  nativeReplayIdentity:
    "Operator-loaded matching replay; the Replay API exposes a process ID, not a replay-file digest",
  reconstruction: movement.summary,
  scope:
    "Sampled XZ positions only; not animation, facing, visibility, or full-match proof",
  summary: {
    observations: observations.length,
    compared: distances.length,
    withoutPath: observations.length - distances.length,
    median: percentile(0.5),
    p90: percentile(0.9),
    max: distances.at(-1),
    baseline657: (() => {
      const values = observations
        .map((v) => v.baselineDistance)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return {
        median: values[Math.floor(values.length / 2)],
        p90: values[Math.floor(values.length * 0.9)],
        max: values.at(-1),
      };
    })(),
  },
  observations,
};
await Bun.write(resolve(outputPath), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.summary));
