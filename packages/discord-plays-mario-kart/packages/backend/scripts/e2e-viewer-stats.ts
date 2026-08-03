#!/usr/bin/env bun
// Receive-side WebRTC ruler for the Discord viewer (2026-08-03 latency plan).
//
// Polls RTCInboundRtpStreamStats from a PinchTab-driven Discord web-client tab
// that is watching the Go-Live stream, giving direct viewer-side numbers
// (jitterBufferDelay, freezeCount, packetsLost, …) that no server-side metric
// can see. Replaces the ~330ms screenshot-quantized glass sampling for the
// Discord leg and attributes display freezes (client jitter buffer vs network
// vs renderer).
//
// Discord does not expose its RTCPeerConnection, so the script first installs
// a constructor hook that records every PC the page creates. The hook only
// captures NEW connections: install it BEFORE the viewer joins voice/watches
// the stream (or pass --reload to reload the tab after hooking, then re-join
// voice and re-open the stream via your driver rig before sampling starts).
//
// Usage:
//   bun run scripts/e2e-viewer-stats.ts --tab <tabId> [--duration 120]
//     [--interval-ms 250] [--out /path/report.json] [--pinchtab http://localhost:9867]
//     [--reload]
// Token: PINCHTAB_TOKEN env, else .server.token from the standard PinchTab
// config files.
import path from "node:path";
import { z } from "zod";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv.at(i + 1);
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return v;
}

function requiredArg(name: string): string {
  const v = argValue(name);
  if (v === undefined) throw new Error(`${name} <value> is required`);
  return v;
}

// Sampling knobs must be finite and positive. Number() otherwise accepts 0, -1,
// "foo" (NaN), and "Infinity": a non-positive interval hammers PinchTab as fast
// as requests complete, and an infinite/NaN duration either never terminates or
// dies later with the misleading "no samples collected" error. Fail up front.
function positiveFiniteArg(name: string, fallback: number): number {
  const raw = argValue(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${name} must be a finite positive number (got ${raw ?? String(fallback)})`,
    );
  }
  return value;
}

const TAB = requiredArg("--tab");
const DURATION_S = positiveFiniteArg("--duration", 120);
const INTERVAL_MS = positiveFiniteArg("--interval-ms", 250);
const OUT = argValue("--out") ?? `viewer-stats-${String(Date.now())}.json`;
const BASE = argValue("--pinchtab") ?? "http://localhost:9867";
const RELOAD = process.argv.includes("--reload");

async function pinchtabToken(): Promise<string> {
  const fromEnv = Bun.env["PINCHTAB_TOKEN"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const home = Bun.env["HOME"];
  if (home === undefined) throw new Error("HOME is not set");
  const candidates = [
    path.join(home, "Library/Application Support/pinchtab/config.json"),
    path.join(home, ".pinchtab/config.json"),
  ];
  for (const file of candidates) {
    const f = Bun.file(file);
    if (!(await f.exists())) continue;
    const parsed = z
      .object({ server: z.object({ token: z.string().min(1) }) })
      .safeParse(JSON.parse(await f.text()));
    if (parsed.success) return parsed.data.server.token;
  }
  throw new Error(
    "no PinchTab token: set PINCHTAB_TOKEN or provide a config file",
  );
}

const TOKEN = await pinchtabToken();

async function evaluate(expression: string): Promise<unknown> {
  const res = await fetch(`${BASE}/tabs/${TAB}/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ expression }),
  });
  if (!res.ok) {
    throw new Error(`evaluate failed: ${String(res.status)}`);
  }
  const body = z.object({ result: z.unknown() }).parse(await res.json());
  return body.result;
}

// Retry an evaluate until the page realm is ready. A reload tears down the
// evaluation context, so the first calls against the fresh page throw until
// navigation settles; this polls through that window instead of racing it.
async function evaluateWithRetry(
  expression: string,
  attempts: number,
  delayMs: number,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await evaluate(expression);
    } catch (error) {
      lastErr = error;
      await sleep(delayMs);
    }
  }
  throw new Error(
    `evaluate did not succeed after ${String(attempts)} attempts: ${String(lastErr)}`,
  );
}

// Constructor hook. Idempotent; static members (generateCertificate) are
// carried via setPrototypeOf so Discord's own code keeps working.
const HOOK = `(() => {
  if (globalThis.__rtcHooked) return "already-hooked";
  globalThis.__rtcHooked = true;
  globalThis.__rtcPeers = [];
  const Orig = globalThis.RTCPeerConnection;
  function Hooked(...args) {
    const pc = new Orig(...args);
    globalThis.__rtcPeers.push(pc);
    return pc;
  }
  Hooked.prototype = Orig.prototype;
  Object.setPrototypeOf(Hooked, Orig);
  globalThis.RTCPeerConnection = Hooked;
  return "hooked";
})()`;

// One poll tick: kick an async getStats() into globalThis.__vsLast and return
// the PREVIOUS completed sample (PinchTab's evaluate is synchronous-only, so
// each call collects the sample the prior call scheduled — INTERVAL_MS stale,
// with its own page-side Date.now() stamp).
const POLL = `(() => {
  const prev = globalThis.__vsLast ?? null;
  globalThis.__vsLast = null;
  const peers = globalThis.__rtcPeers ?? [];
  const live = peers.filter((p) => p.connectionState === "connected");
  const pc = live.at(-1) ?? peers.at(-1);
  // Serialize getStats(): if the previous call is still pending — getStats can
  // outlast --interval-ms during the very viewer stalls this ruler diagnoses —
  // skip this tick instead of racing a second promise into the single __vsLast
  // slot, where out-of-order resolution would reverse or drop counter samples.
  if (pc && globalThis.__vsInFlight !== true) {
    globalThis.__vsInFlight = true;
    // Tag this request with the current run generation. A getStats() still in
    // flight from a PRIOR run resolves into an old generation and is discarded
    // below, so it can't repopulate __vsLast with a cross-run sample while this
    // run waits behind __vsInFlight.
    const gen = globalThis.__vsGen;
    pc.getStats().then((report) => {
      if (globalThis.__vsGen !== gen) return;
      const out = { pageAtMs: Date.now(), video: null, pairRttMs: null };
      let selectedPairId = null;
      // A connection can carry several inbound video streams (other cameras,
      // extra screen shares, a retained track after an SSRC/quality switch).
      // Pick the one actually receiving now — freshest lastPacketReceivedTimestamp,
      // then most framesReceived — so an idle/stale track can't win by being
      // visited last.
      let bestRank = null;
      report.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "video") {
          const rank = [
            typeof s.lastPacketReceivedTimestamp === "number"
              ? s.lastPacketReceivedTimestamp
              : -1,
            typeof s.framesReceived === "number" ? s.framesReceived : -1,
          ];
          if (
            bestRank === null ||
            rank[0] > bestRank[0] ||
            (rank[0] === bestRank[0] && rank[1] > bestRank[1])
          ) {
            bestRank = rank;
            out.video = {
              ssrc: s.ssrc ?? null,
              framesReceived: s.framesReceived ?? null,
              framesDecoded: s.framesDecoded ?? null,
              framesDropped: s.framesDropped ?? null,
              framesPerSecond: s.framesPerSecond ?? null,
              freezeCount: s.freezeCount ?? null,
              totalFreezesDuration: s.totalFreezesDuration ?? null,
              pauseCount: s.pauseCount ?? null,
              totalPausesDuration: s.totalPausesDuration ?? null,
              jitter: s.jitter ?? null,
              jitterBufferDelay: s.jitterBufferDelay ?? null,
              jitterBufferEmittedCount: s.jitterBufferEmittedCount ?? null,
              packetsReceived: s.packetsReceived ?? null,
              packetsLost: s.packetsLost ?? null,
              nackCount: s.nackCount ?? null,
              totalDecodeTime: s.totalDecodeTime ?? null,
              estimatedPlayoutTimestamp: s.estimatedPlayoutTimestamp ?? null,
              lastPacketReceivedTimestamp: s.lastPacketReceivedTimestamp ?? null,
            };
          }
        }
        if (
          s.type === "transport" &&
          typeof s.selectedCandidatePairId === "string"
        ) {
          selectedPairId = s.selectedCandidatePairId;
        }
      });
      // RTT must come from the ONE pair actually carrying media. Read the pair
      // named by the transport's selectedCandidatePairId; accepting every
      // "succeeded" pair let forEach leave whichever idle pair it visited last.
      let rtt = null;
      if (selectedPairId !== null) {
        const pair = report.get(selectedPairId);
        if (pair && typeof pair.currentRoundTripTime === "number") {
          rtt = pair.currentRoundTripTime;
        }
      }
      if (rtt === null) {
        // Older stacks omit transport.selectedCandidatePairId; fall back to the
        // nominated+succeeded pair (spec guarantees at most one).
        report.forEach((s) => {
          if (
            s.type === "candidate-pair" &&
            s.nominated === true &&
            s.state === "succeeded" &&
            typeof s.currentRoundTripTime === "number"
          ) {
            rtt = s.currentRoundTripTime;
          }
        });
      }
      if (rtt !== null) out.pairRttMs = rtt * 1000;
      globalThis.__vsLast = out;
    }).catch(() => {
      // A peer can close between selection and getStats(); drop this tick and
      // let the next poll re-select a live peer.
    }).finally(() => {
      // Only the current generation owns the in-flight guard; a stale run's
      // resolution must not clear this run's flag.
      if (globalThis.__vsGen === gen) globalThis.__vsInFlight = false;
    });
  }
  return JSON.stringify({ prev, peerCount: peers.length, liveCount: live.length });
})()`;

// Run-generation init: bump __vsGen and clear the in-flight guard + last-sample
// slot. Any getStats() still pending from a prior invocation belongs to an
// earlier generation and is discarded on resolution (see POLL), so it cannot
// leak a cross-run sample into this window.
const RUN_INIT = `(() => {
  globalThis.__vsGen = (globalThis.__vsGen ?? 0) + 1;
  globalThis.__vsInFlight = false;
  globalThis.__vsLast = null;
  return String(globalThis.__vsGen);
})()`;

const VideoStatsSchema = z.object({
  ssrc: z.number().nullable(),
  framesReceived: z.number().nullable(),
  framesDecoded: z.number().nullable(),
  framesDropped: z.number().nullable(),
  framesPerSecond: z.number().nullable(),
  freezeCount: z.number().nullable(),
  totalFreezesDuration: z.number().nullable(),
  pauseCount: z.number().nullable(),
  totalPausesDuration: z.number().nullable(),
  jitter: z.number().nullable(),
  jitterBufferDelay: z.number().nullable(),
  jitterBufferEmittedCount: z.number().nullable(),
  packetsReceived: z.number().nullable(),
  packetsLost: z.number().nullable(),
  nackCount: z.number().nullable(),
  totalDecodeTime: z.number().nullable(),
  estimatedPlayoutTimestamp: z.number().nullable(),
  lastPacketReceivedTimestamp: z.number().nullable(),
});
const PollSchema = z.object({
  prev: z
    .object({
      pageAtMs: z.number(),
      video: VideoStatsSchema.nullable(),
      pairRttMs: z.number().nullable(),
    })
    .nullable(),
  peerCount: z.number(),
  liveCount: z.number(),
});
type Sample = NonNullable<z.infer<typeof PollSchema>["prev"]> & {
  localAtMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const hookResult = await evaluate(HOOK);
console.error(`hook: ${String(hookResult)}`);
if (RELOAD) {
  // A genuine reload tears down the evaluation context, so this evaluate can
  // reject even though the reload succeeded. Capture any error but DON'T treat
  // it as success — the fresh-realm hook below is the independent oracle. An
  // HTTP/auth/network/PinchTab failure that prevents navigation is caught there.
  let reloadError: unknown;
  try {
    await evaluate("location.reload() ?? 'reloading'");
  } catch (error) {
    reloadError = error;
  }
  // A real reload drops the constructor hook (__rtcHooked / __rtcPeers / the
  // patched RTCPeerConnection) with the old realm, so reinstalling it on the
  // fresh page returns "hooked". "already-hooked" means the page never
  // navigated — the old realm (and its uncaptured peer) is still live — so fail
  // instead of telling the operator to rejoin into a bogus run.
  const reHookResult = await evaluateWithRetry(HOOK, 30, 500);
  if (reHookResult !== "hooked") {
    const reloadDetail =
      reloadError === undefined
        ? ""
        : ` reload error: ${reloadError instanceof Error ? reloadError.message : JSON.stringify(reloadError)}`;
    throw new Error(
      `--reload did not navigate the tab (hook returned ${JSON.stringify(reHookResult)}); ` +
        "the existing peer is still uncaptured. Check the PinchTab tab id, token, and connectivity." +
        reloadDetail,
    );
  }
  console.error(`re-hook: ${reHookResult}`);
  console.error(
    "reloaded — re-join voice + re-open the stream, then sampling begins",
  );
  await sleep(8000);
}

// Start a fresh run generation immediately before sampling: bump __vsGen and
// clear the in-flight guard / last-sample slot so no prior run's still-pending
// getStats() can leak a cross-run sample into this window. Runs after the
// --reload re-hook so it targets the post-reload realm.
const runGen = await evaluate(RUN_INIT);
console.error(`run generation: ${String(runGen)}`);

const samples: Sample[] = [];
let polls = 0;
let noPeerPolls = 0;
const endAt = Date.now() + DURATION_S * 1000;
while (Date.now() < endAt) {
  const t0 = Date.now();
  const raw = await evaluate(POLL);
  polls++;
  const parsed = PollSchema.parse(JSON.parse(z.string().parse(raw)));
  if (parsed.peerCount === 0) noPeerPolls++;
  if (parsed.prev !== null) {
    samples.push({ ...parsed.prev, localAtMs: t0 });
  }
  const elapsed = Date.now() - t0;
  if (elapsed < INTERVAL_MS) await sleep(INTERVAL_MS - elapsed);
}

if (samples.length === 0) {
  throw new Error(
    `no samples collected over ${String(polls)} polls (${String(noPeerPolls)} saw zero hooked peers). ` +
      "Install the hook BEFORE the viewer joins voice/watches the stream, or use --reload.",
  );
}

// Counters are per-RTCPeerConnection and per-SSRC; a stream restart or peer
// switch mid-window resets them (or swaps to a different track), so a
// first-to-last delta across that boundary is meaningless. Detect both a
// backwards jump in decoded frames and a change in the selected SSRC.
const decodeCounts: number[] = [];
for (const s of samples) {
  const decoded = s.video?.framesDecoded;
  if (typeof decoded === "number") decodeCounts.push(decoded);
}
const countersWentBackwards = decodeCounts.some(
  (v, i) => i > 0 && v < (decodeCounts[i - 1] ?? 0),
);
const ssrcs = new Set<number>();
for (const s of samples) {
  const ssrc = s.video?.ssrc;
  if (typeof ssrc === "number") ssrcs.add(ssrc);
}
if (countersWentBackwards || ssrcs.size > 1) {
  // Refuse to emit misleading cross-connection deltas. Persist the raw samples
  // for inspection, then fail so a caller can't mistake spliced counters for a
  // valid experiment result.
  const reasons: string[] = [];
  if (countersWentBackwards) reasons.push("framesDecoded went backwards");
  if (ssrcs.size > 1) reasons.push(`${String(ssrcs.size)} distinct SSRCs`);
  await Bun.write(
    OUT,
    JSON.stringify(
      {
        summary: {
          note: `aborted: inbound counters reset mid-window (${reasons.join("; ")})`,
        },
        samples,
      },
      null,
      1,
    ),
  );
  throw new Error(
    `inbound counters reset mid-window (${reasons.join("; ")}); refusing to emit ` +
      `cross-connection window deltas. Re-run without a mid-run stream restart / ` +
      `peer switch. Raw samples written to ${OUT}.`,
  );
}
// A counter present at one endpoint but absent at the other cannot yield a real
// delta; coercing null→0 would fake a zero (or manufacture a negative delta).
// Return null for such a delta instead.
const delta = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null ? b - a : null;

// The start-before-join workflow can capture the peer before its inbound video
// stats appear, so early samples have `video: null`. Anchor the window on the
// first and last samples that actually carry video, not the raw run endpoints —
// otherwise a single leading null sample collapses the whole run to "no stats".
function buildSummary() {
  const videoSamples = samples.filter((s) => s.video !== null);
  if (videoSamples.length === 0) {
    return { note: "no inbound video stats present" };
  }
  // A single video-bearing sample has no window: spanS would be 0 and every
  // cumulative-counter delta 0, indistinguishable from a genuine
  // no-freeze/no-loss result. Require at least two video samples before
  // summarizing.
  if (videoSamples.length < 2) {
    return {
      note: `insufficient video-bearing samples for a window (need >= 2, got ${String(videoSamples.length)})`,
    };
  }
  const firstVideo = videoSamples.at(0);
  const lastVideo = videoSamples.at(-1);
  if (firstVideo === undefined || lastVideo === undefined) {
    return { note: "no inbound video stats present" };
  }
  const v0 = firstVideo.video;
  const v1 = lastVideo.video;
  if (v0 === null || v1 === null) {
    return { note: "no inbound video stats present" };
  }
  const spanS = (lastVideo.pageAtMs - firstVideo.pageAtMs) / 1000;
  // Two samples with the same page-side timestamp still yield no measurable
  // window; reject a non-positive span rather than emit rates over zero time.
  if (spanS <= 0) {
    return {
      note: `non-positive window span (${String(spanS)}s) across video-bearing samples`,
    };
  }
  return {
    spanS,
    framesDecodedDelta: delta(v0.framesDecoded, v1.framesDecoded),
    freezeCountDelta: delta(v0.freezeCount, v1.freezeCount),
    freezeDurationDeltaS: delta(
      v0.totalFreezesDuration,
      v1.totalFreezesDuration,
    ),
    packetsLostDelta: delta(v0.packetsLost, v1.packetsLost),
    nackDelta: delta(v0.nackCount, v1.nackCount),
    // Mean time a frame sat in the jitter buffer over the window (W3C:
    // cumulative seconds / cumulative emitted frames).
    meanJitterBufferMs:
      v1.jitterBufferDelay !== null &&
      v0.jitterBufferDelay !== null &&
      v1.jitterBufferEmittedCount !== null &&
      v0.jitterBufferEmittedCount !== null &&
      v1.jitterBufferEmittedCount > v0.jitterBufferEmittedCount
        ? ((v1.jitterBufferDelay - v0.jitterBufferDelay) /
            (v1.jitterBufferEmittedCount - v0.jitterBufferEmittedCount)) *
          1000
        : null,
  };
}
const summary = buildSummary();

await Bun.write(OUT, JSON.stringify({ summary, samples }, null, 1));
console.error(
  `wrote ${OUT}: ${String(samples.length)} samples; summary ${JSON.stringify(summary)}`,
);
