// Local research. Demux packet metadata without decoding or exporting media.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay } from "../transport.mjs";

const require = createRequire(
  new URL(
    "../../../../../packages/discord-video-stream/package.json",
    import.meta.url,
  ),
);
const digestPattern = /^[a-f0-9]{64}$/;

const sourceByRole = {
  native: "riot-replay-api-recording",
  browser: "browser-replay-recording",
};

export function validateRecordingReceipt(identity, receipt, role = "native") {
  if (!Object.hasOwn(sourceByRole, role)) throw Error("Unknown recording role");
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.purpose !== "local-verification-only" ||
    ["build", "protocol", "durationMilliseconds", "replaySha256"].some(
      (field) => receipt[field] !== identity[field],
    )
  )
    throw Error(
      `${role === "native" ? "Native" : "Browser"} recording receipt replay identity mismatch`,
    );
  const reference = receipt.reference;
  if (
    reference?.source !== sourceByRole[role] ||
    reference.replayIdentity !== "operator-confirmed" ||
    reference.replayDigestAttestedByApi !== false ||
    reference.operatorReviewed !== true ||
    reference.playbackRate !== 1 ||
    typeof receipt.mediaSha256 !== "string" ||
    !digestPattern.test(receipt.mediaSha256)
  )
    throw Error(`Missing independently reviewed ${role} recording evidence`);
  const { startSeconds, endSeconds } = receipt.window ?? {};
  const { replaySeconds, mediaPtsSeconds } = receipt.mediaClockAnchor ?? {};
  if (
    ![startSeconds, endSeconds, replaySeconds, mediaPtsSeconds].every(
      Number.isFinite,
    ) ||
    startSeconds < 0 ||
    !(startSeconds < endSeconds) ||
    endSeconds > identity.durationMilliseconds / 1000 ||
    replaySeconds < startSeconds ||
    replaySeconds > endSeconds
  )
    throw Error(
      `Invalid ${role} recording window or reviewed media clock anchor`,
    );
  const startPtsSeconds = mediaPtsSeconds + (startSeconds - replaySeconds);
  const endPtsSeconds = mediaPtsSeconds + (endSeconds - replaySeconds);
  if (
    !Number.isFinite(startPtsSeconds) ||
    !Number.isFinite(endPtsSeconds) ||
    !(endPtsSeconds > startPtsSeconds)
  )
    throw Error("Invalid mapped media timestamp interval");
  return { startPtsSeconds, endPtsSeconds };
}

export function validateComparisonReceipts(identity, native, browser) {
  const nativeWindow = validateRecordingReceipt(identity, native);
  const browserWindow = validateRecordingReceipt(identity, browser, "browser");
  const { startSeconds, endSeconds } = native.window;
  if (
    startSeconds !== browser.window.startSeconds ||
    endSeconds !== browser.window.endSeconds
  )
    throw Error("Reviewed replay windows differ");
  if (native.mediaSha256 === browser.mediaSha256)
    throw Error("Expected independently recorded native and browser media");
  return {
    replayWindow: { startSeconds, endSeconds },
    nativeWindow,
    browserWindow,
  };
}

function exceedsAtClockPrecision(left, right) {
  const roundoff =
    4 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
  return left - right > roundoff;
}

export function verifyRecordingCoverage(tracks, window, role = "native") {
  for (const kind of ["video", "audio"]) {
    const matches = tracks.filter((track) => track.kind === kind);
    if (matches.length !== 1)
      throw Error(`Expected one ${kind} track in the ${role} recording`);
    const [track] = matches;
    if (
      track.packets === 0 ||
      track.packetsWithoutPts !== 0 ||
      !Number.isFinite(track.startPtsSeconds) ||
      !Number.isFinite(track.endPtsSeconds) ||
      exceedsAtClockPrecision(track.startPtsSeconds, window.startPtsSeconds) ||
      exceedsAtClockPrecision(window.endPtsSeconds, track.endPtsSeconds)
    )
      throw Error(
        `${role === "native" ? "Native" : "Browser"} recording ${kind} packet timestamps do not cover the reviewed window`,
      );
  }
}

export function summarizePacketTiming(packets, window) {
  const ordered = packets.toSorted(([left], [right]) => left - right);
  const { startPtsSeconds, endPtsSeconds } = window;
  let coveredUntil = startPtsSeconds;
  let previousStart = null;
  let largestStartStep = null;
  let largestGap = 0;
  let packetsWithUnknownDuration = 0;
  for (const [start, end] of ordered) {
    if (end < startPtsSeconds) continue;
    if (start > endPtsSeconds) break;
    if (end === start) packetsWithUnknownDuration++;
    if (start >= startPtsSeconds) {
      if (previousStart !== null)
        largestStartStep = Math.max(
          largestStartStep ?? 0,
          start - previousStart,
        );
      previousStart = start;
    }
    largestGap = Math.max(largestGap, start - coveredUntil);
    coveredUntil = Math.max(coveredUntil, end);
  }
  largestGap = Math.max(largestGap, endPtsSeconds - coveredUntil);
  return {
    largestPacketStartStepSeconds: largestStartStep,
    largestGapBetweenDeclaredPacketsSeconds:
      packetsWithUnknownDuration === 0 ? largestGap : null,
    packetsWithUnknownDuration,
  };
}

export async function mediaDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function readMediaMetadata(path, window) {
  const { AV_NOPTS_VALUE, AVMEDIA_TYPE_AUDIO, AVMEDIA_TYPE_VIDEO, Demuxer } =
    await import(pathToFileURL(require.resolve("node-av")));
  const demuxer = await Demuxer.open(path, { format: "matroska" });
  try {
    const byIndex = new Map();
    for (const stream of demuxer.streams) {
      const type = stream.codecpar.codecType;
      if (type !== AVMEDIA_TYPE_VIDEO && type !== AVMEDIA_TYPE_AUDIO) continue;
      byIndex.set(stream.index, {
        kind: type === AVMEDIA_TYPE_VIDEO ? "video" : "audio",
        packets: 0,
        packetsWithoutPts: 0,
        startPtsSeconds: null,
        endPtsSeconds: null,
        timestamps: [],
      });
    }
    for await (const packet of demuxer.packets()) {
      if (packet === null) continue;
      try {
        const track = byIndex.get(packet.streamIndex);
        if (!track) continue;
        track.packets++;
        const { num, den } = packet.timeBase;
        const scale = num / den;
        const start = Number(packet.pts) * scale;
        const end =
          Number(packet.pts + (packet.duration > 0n ? packet.duration : 0n)) *
          scale;
        if (
          packet.pts === AV_NOPTS_VALUE ||
          !(scale > 0) ||
          !Number.isFinite(start) ||
          !Number.isFinite(end)
        ) {
          track.packetsWithoutPts++;
          continue;
        }
        track.startPtsSeconds = Math.min(track.startPtsSeconds ?? start, start);
        track.endPtsSeconds = Math.max(track.endPtsSeconds ?? end, end);
        track.timestamps.push([start, end]);
      } finally {
        packet.free();
      }
    }
    return {
      containerDurationSeconds: demuxer.duration || null,
      tracks: [...byIndex.values()].map(({ timestamps, ...track }) => ({
        ...track,
        timing:
          timestamps.length === 0
            ? null
            : summarizePacketTiming(timestamps, window ?? track),
      })),
    };
  } finally {
    await demuxer.close();
  }
}

async function readReplayIdentity(replayPath) {
  const bytes = new Uint8Array(await readFile(replayPath));
  const { build, protocol, durationMilliseconds } = openReplay(bytes.buffer);
  const replaySha256 = createHash("sha256").update(bytes).digest("hex");
  return { build, protocol, durationMilliseconds, replaySha256 };
}

async function readReviewedMedia(path, receipt, window, role = "native") {
  const mediaPath = resolve(path);
  if (!(await stat(mediaPath)).isFile())
    throw Error("Expected a local recording file");
  const label = role === "native" ? "Native" : "Browser";
  if ((await mediaDigest(mediaPath)) !== receipt.mediaSha256)
    throw Error(`${label} recording digest differs from the reviewed receipt`);
  const metadata = await readMediaMetadata(mediaPath, window);
  if ((await mediaDigest(mediaPath)) !== receipt.mediaSha256)
    throw Error(`${label} recording changed during inspection`);
  verifyRecordingCoverage(metadata.tracks, window, role);
  return metadata;
}

async function compare([
  replayPath,
  nativePath,
  nativeReceiptPath,
  browserPath,
  browserReceiptPath,
]) {
  const identity = await readReplayIdentity(replayPath);
  const nativeReceipt = JSON.parse(await readFile(nativeReceiptPath, "utf8"));
  const browserReceipt = JSON.parse(await readFile(browserReceiptPath, "utf8"));
  const { replayWindow, nativeWindow, browserWindow } =
    validateComparisonReceipts(identity, nativeReceipt, browserReceipt);
  const native = await readReviewedMedia(
    nativePath,
    nativeReceipt,
    nativeWindow,
  );
  const browser = await readReviewedMedia(
    browserPath,
    browserReceipt,
    browserWindow,
    "browser",
  );
  return {
    evidence: "operator-reviewed-recording-metadata-comparison",
    scope:
      "matched 1x replay window, audio and video packet timestamp extents and gaps",
    identity,
    replayWindow,
    playbackRate: 1,
    native: {
      mediaSha256: nativeReceipt.mediaSha256,
      mediaClockAnchor: nativeReceipt.mediaClockAnchor,
      window: nativeWindow,
      ...native,
    },
    browser: {
      mediaSha256: browserReceipt.mediaSha256,
      mediaClockAnchor: browserReceipt.mediaClockAnchor,
      window: browserWindow,
      ...browser,
    },
  };
}

async function main([mode, ...args]) {
  if (mode === "compare" && args.length === 5) return compare(args);
  const [path, replayPath, receiptPath, ...extra] = args;
  if (
    !path ||
    extra.length ||
    (mode === "probe"
      ? Boolean(replayPath || receiptPath)
      : mode !== "verify" || !replayPath || !receiptPath)
  )
    throw Error(
      "Usage: node verify-native-recording-metadata.mjs probe <clip.webm> | verify <clip.webm> <replay.rofl> <receipt.json> | compare <replay.rofl> <native.webm> <native-reviewed.json> <browser.webm> <browser-reviewed.json>",
    );
  if (mode === "probe") {
    const mediaPath = resolve(path);
    if (!(await stat(mediaPath)).isFile())
      throw Error("Expected a local recording file");
    return {
      evidence: "unattested-metadata-only",
      ...(await readMediaMetadata(mediaPath)),
    };
  }

  const identity = await readReplayIdentity(replayPath);
  const { build, protocol } = identity;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const window = validateRecordingReceipt(identity, receipt);
  const metadata = await readReviewedMedia(path, receipt, window);
  return {
    evidence: "operator-reviewed-native-recording",
    build,
    protocol,
    scope: "audio and video packet timestamp extents and gaps",
    window,
    ...metadata,
  };
}

if (import.meta.main) {
  const result = await main(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}
