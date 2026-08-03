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

const TAB = requiredArg("--tab");
const DURATION_S = Number(argValue("--duration") ?? 120);
const INTERVAL_MS = Number(argValue("--interval-ms") ?? 250);
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
    pc.getStats().then((report) => {
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
      globalThis.__vsInFlight = false;
    });
  }
  return JSON.stringify({ prev, peerCount: peers.length, liveCount: live.length });
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
// A previous run's final getStats() resolves after that run exits, leaving a
// stale sample in __vsLast. Without this reset the first poll of the NEXT run
// returns it — a sample minutes old, often from a since-closed peer, which
// silently corrupts every window delta computed from sample[0].
await evaluate("(globalThis.__vsLast = null) ?? 'cleared'");
if (RELOAD) {
  await evaluate("location.reload() ?? 'reloading'").catch(() => {
    // The navigation tears down the evaluation context; that IS the success
    // signal for a reload.
  });
  // The reload destroyed the page realm that held the constructor hook
  // (__rtcHooked / __rtcPeers / the patched RTCPeerConnection), so any peer the
  // operator creates after rejoining would go unrecorded and every poll would
  // see zero peers. Wait for the fresh realm and reinstall the hook BEFORE
  // asking them to rejoin.
  const reHookResult = await evaluateWithRetry(HOOK, 30, 500);
  console.error(`re-hook: ${String(reHookResult)}`);
  console.error(
    "reloaded — re-join voice + re-open the stream, then sampling begins",
  );
  await sleep(8000);
}

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

const first = samples.at(0);
const last = samples.at(-1);
if (first === undefined || last === undefined) {
  throw new Error("unreachable: samples is non-empty");
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
const v0 = first.video;
const v1 = last.video;
// A counter present at one endpoint but absent at the other cannot yield a real
// delta; coercing null→0 would fake a zero (or manufacture a negative delta).
// Return null for such a delta instead.
const delta = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null ? b - a : null;
const summary =
  v0 === null || v1 === null
    ? { note: "no inbound video stats present" }
    : {
        spanS: (last.pageAtMs - first.pageAtMs) / 1000,
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

await Bun.write(OUT, JSON.stringify({ summary, samples }, null, 1));
console.error(
  `wrote ${OUT}: ${String(samples.length)} samples; summary ${JSON.stringify(summary)}`,
);
