// Local research. Read exact replay evidence and emit only aggregate observations.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { sameGameBuild } from "../../../../../packages/scout-for-lol/packages/domain/src/artifacts/replay-transport.mjs";
import { verifyReplayParticipantBindings } from "../replay-participant-bindings.mjs";
import { openReplay } from "../transport.mjs";
import { planPositionComparison } from "./research/compare-reference-positions.mjs";

const extent = (values) => ({
  min: Math.min(...values),
  max: Math.max(...values),
});
const diagonal = ([x, , z]) => x + z;
const authoredEntry = "data/maps/mapgeometry/map11/base_srx.materials.bin";

export function requireDisjointCapturePlans(identity, calibration, heldOut) {
  const plans = [calibration, heldOut].map((receipt) => {
    const method = planPositionComparison(identity, receipt);
    if (
      method.captureMethod !== "continuous" ||
      !Number.isSafeInteger(receipt.reference.processID) ||
      receipt.reference.processID <= 0
    )
      throw Error(
        "Expected a native continuous receipt with an observed process",
      );
    return method.sampleTimes;
  });
  const calibrationObserved = new Set(plans[0].map(({ time }) => time));
  const calibrationRequested = new Set(
    plans[0].map(({ requestedTime }) => requestedTime),
  );
  if (
    calibrationObserved.size !== plans[0].length ||
    new Set(plans[1].map(({ time }) => time)).size !== plans[1].length ||
    plans[1].some(
      ({ time, requestedTime }) =>
        calibrationObserved.has(time) ||
        calibrationRequested.has(requestedTime),
    )
  )
    throw Error(
      "Calibration and held-out receipts require distinct clock observations and requests",
    );
  return plans;
}

export function verifyNativeOrientation(
  { build, roster },
  calibrationSamples,
  heldOutSamples,
  placement,
) {
  // The installed 16.23 compatibility version combines the three-digit build
  // and four-digit revision into a single component before build metadata.
  const installed =
    typeof placement.installedCompatibilityVersion === "string"
      ? /^(\d{1,2}\.\d{1,2})\.(\d{3})(\d{4})(?:\+[A-Za-z0-9.-]+)?$/.exec(
          placement.installedCompatibilityVersion,
        )
      : null;
  if (
    !installed ||
    !sameGameBuild(build, `${installed[1]}.${installed[2]}.${installed[3]}`)
  )
    throw Error("Installed placement build differs from the replay build");
  if (
    placement.entryPath !== authoredEntry ||
    placement.archivedBuild !== "16.21.829.8620" ||
    placement.attackableType !== 0 ||
    placement.uniqueMatches !== 24 ||
    !/^[a-f0-9]{64}$/.test(placement.archivedSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(placement.installedSha256 ?? "") ||
    !Array.isArray(placement.records) ||
    placement.records.length !== 24 ||
    new Set(placement.records.map(({ keyHash }) => keyHash)).size !== 24 ||
    new Set(placement.records.map(({ installedOffset }) => installedOffset))
      .size !== 24 ||
    placement.records.some(
      ({ translation, explicitTeam, sha256, installedOffset, keyHash }) =>
        !Array.isArray(translation) ||
        translation.length !== 3 ||
        !translation.every(Number.isFinite) ||
        ![null, 200].includes(explicitTeam) ||
        !Number.isInteger(keyHash) ||
        keyHash < 0 ||
        keyHash > 0xffffffff ||
        !Number.isSafeInteger(installedOffset) ||
        installedOffset < 0 ||
        !/^[a-f0-9]{64}$/.test(sha256 ?? ""),
    )
  )
    throw Error("Expected the verified local Map11 placement receipt");
  const authored = [null, 200].map((team) =>
    placement.records
      .filter(({ explicitTeam }) => explicitTeam === team)
      .map(({ translation }) => diagonal(translation)),
  );
  if (authored.some((values) => values.length !== 12))
    throw Error("Unexpected authored Map11 team cohorts");
  const unknown = extent(authored[0]);
  const explicitTeam200 = extent(authored[1]);
  if (unknown.max >= explicitTeam200.min)
    throw Error("Authored Map11 diagonal cohorts do not separate");
  const summarize = (samples) =>
    [100, 200].map((team) => {
      const values = samples
        .filter(({ key }) => roster[key - 1]?.team === team)
        .map(({ position }) => diagonal(position));
      return {
        team,
        observations: values.length,
        diagonalExtent: extent(values),
        low: values.filter((value) => value <= unknown.max).length,
        high: values.filter((value) => value >= explicitTeam200.min).length,
        between: values.filter(
          (value) => value > unknown.max && value < explicitTeam200.min,
        ).length,
      };
    });
  const calibration = summarize(calibrationSamples);
  if (
    calibration[0].observations !== 5 ||
    calibration[1].observations !== 5 ||
    calibration[0].low !== 5 ||
    calibration[1].high !== 5
  )
    throw Error(
      "Native calibration team orientations disagree with authored diagonal separation",
    );
  return {
    authored: {
      unknown: { count: 12, diagonalExtent: unknown },
      explicitTeam200: { count: 12, diagonalExtent: explicitTeam200 },
    },
    calibration,
    heldOut: summarize(heldOutSamples),
  };
}

function packetBrackets(times) {
  const float = new DataView(new ArrayBuffer(4));
  let priorTime;
  let priorSecondary;
  let next = 0;
  const widths = [];
  const offsets = [];
  function seconds(bits) {
    float.setUint32(0, bits, true);
    const value = float.getFloat32(0, true);
    if (!Number.isFinite(value)) throw Error("Invalid packet secondary clock");
    return value;
  }
  return {
    observeGameplayPacket({ timeSeconds, secondTimeBits }) {
      while (next < times.length && timeSeconds > times[next]) {
        if (priorTime === undefined)
          throw Error("Missing gameplay envelope before a native observation");
        widths.push(timeSeconds - priorTime);
        offsets.push(
          seconds(priorSecondary) - priorTime,
          seconds(secondTimeBits) - timeSeconds,
        );
        next++;
      }
      priorTime = timeSeconds;
      priorSecondary = secondTimeBits;
    },
    finish() {
      if (next !== times.length)
        throw Error("Missing gameplay envelope after a native observation");
      return {
        scope: "packet secondary clock minus normalized packet primary clock",
        bracketedObservationTimes: next,
        bracketWidthSeconds: extent(widths),
        packetToPacketOffsetSeconds: extent(offsets),
      };
    },
  };
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (import.meta.main) {
  const [replayPath, placementPath, calibrationPath, heldOutPath, ...extra] =
    process.argv.slice(2);
  if (
    !replayPath ||
    !placementPath ||
    !calibrationPath ||
    !heldOutPath ||
    extra.length
  )
    throw Error(
      "Usage: bun verify-native-replay-orientation.mjs <replay.rofl> <placement.json|-> <calibration.json> <held-out.json>",
    );
  const bytes = new Uint8Array(await readFile(replayPath));
  const replay = openReplay(bytes.buffer);
  const { build, protocol, durationMilliseconds, roster } = replay;
  const identity = {
    build,
    protocol,
    durationMilliseconds,
    participantCount: roster.length,
    replaySha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const placement =
    placementPath === "-"
      ? await Bun.stdin.json()
      : await loadJson(placementPath);
  const [calibration, heldOut] = await Promise.all([
    loadJson(calibrationPath),
    loadJson(heldOutPath),
  ]);
  const plans = requireDisjointCapturePlans(identity, calibration, heldOut);
  const anchor = plans[0][0].time;
  const orientation = verifyNativeOrientation(
    replay,
    calibration.samples.filter(({ time }) => time === anchor),
    heldOut.samples,
    placement,
  );
  const times = plans
    .flatMap((plan) => plan.map(({ time }) => time))
    .sort((a, b) => a - b);
  const brackets = packetBrackets(times);
  const binding = verifyReplayParticipantBindings(
    replay,
    (stored, target) =>
      zstdDecompressSync(stored, { maxOutputLength: target.length }),
    brackets,
  );
  if (binding.verified.length !== roster.length || binding.unresolved.length)
    throw Error(
      "Native orientation requires a fully verified replay actor binding",
    );
  console.log(
    JSON.stringify(
      {
        build,
        protocol,
        boundActors: binding.verified.length,
        calibrationObservationTimes: plans[0].length,
        heldOutObservationTimes: plans[1].length,
        sameNativeProcess:
          calibration.reference.processID === heldOut.reference.processID,
        orientationAtNativeSeconds: anchor,
        orientation,
        transportClock: brackets.finish(),
      },
      null,
      2,
    ),
  );
}
