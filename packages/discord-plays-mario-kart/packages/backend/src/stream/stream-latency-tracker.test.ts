import { describe, expect, it } from "bun:test";
import type { SendStats } from "@shepherdjerred/discord-video-stream";
import {
  StreamLatencyTracker,
  type StreamLatencyObservations,
} from "./stream-latency-tracker.ts";

type Recorded = {
  packetReady: { kind: "video" | "audio"; delayMs: number }[];
  sendComplete: { kind: "video" | "audio"; delayMs: number }[];
  inputPacketReady: number[];
  inputSendComplete: number[];
  avOffsets: number[];
  failures: string[];
};

function makeHarness(startMs = 1000): {
  tracker: StreamLatencyTracker;
  recorded: Recorded;
  advance: (ms: number) => void;
} {
  let nowMs = startMs;
  const recorded: Recorded = {
    packetReady: [],
    sendComplete: [],
    inputPacketReady: [],
    inputSendComplete: [],
    avOffsets: [],
    failures: [],
  };
  const observations: StreamLatencyObservations = {
    observePacketReady: (kind, delayMs) => {
      recorded.packetReady.push({ kind, delayMs });
    },
    observeSendComplete: (kind, delayMs) => {
      recorded.sendComplete.push({ kind, delayMs });
    },
    observeInputToPacketReady: (delayMs) => {
      recorded.inputPacketReady.push(delayMs);
    },
    observeInputToSendComplete: (delayMs) => {
      recorded.inputSendComplete.push(delayMs);
    },
    observeAvContentOffset: (offsetMs) => {
      recorded.avOffsets.push(offsetMs);
    },
    correlationFailure: (kind, reason) => {
      recorded.failures.push(`${kind}:${reason}`);
    },
  };
  return {
    tracker: new StreamLatencyTracker(observations, () => nowMs),
    recorded,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

function sendStats(kind: "video" | "audio", ptsMs: number): SendStats {
  return {
    kind,
    ptsMs,
    ratio: 0.1,
    sendTime: 2,
    frametime: kind === "video" ? 100 / 3 : 20,
    behindMs: 0,
    syncWaitMs: 0,
  };
}

describe("StreamLatencyTracker", () => {
  it("measures controller receipt through video packet readiness and send", () => {
    const { tracker, recorded, advance } = makeHarness();
    tracker.recordVideoSource({
      contentTimeMs: 0,
      availableAtMs: 1000,
      inputReceivedAtMs: 900,
    });

    advance(50);
    tracker.onPacketReady({ kind: "video", ptsMs: 0, durationMs: 100 / 3 });
    advance(25);
    tracker.onSendStats(sendStats("video", 0));

    expect(recorded.packetReady).toEqual([{ kind: "video", delayMs: 50 }]);
    expect(recorded.sendComplete).toEqual([{ kind: "video", delayMs: 75 }]);
    expect(recorded.inputPacketReady).toEqual([150]);
    expect(recorded.inputSendComplete).toEqual([175]);
    expect(recorded.failures).toEqual([]);
  });

  it("waits for every PCM span required by an Opus packet", () => {
    const { tracker, recorded, advance } = makeHarness();
    // Ten milliseconds of stereo s16le at 44.1 kHz.
    const tenMsPcmBytes = 441 * 2 * 2;
    tracker.recordAudioSource({
      pcmBytes: tenMsPcmBytes,
      contentEndMs: 10,
      availableAtMs: 1000,
    });
    tracker.recordAudioSource({
      pcmBytes: tenMsPcmBytes,
      contentEndMs: 20,
      availableAtMs: 1010,
    });

    advance(20);
    tracker.onPacketReady({ kind: "audio", ptsMs: 0, durationMs: 20 });
    advance(5);
    tracker.onSendStats(sendStats("audio", 0));

    expect(recorded.packetReady).toEqual([{ kind: "audio", delayMs: 10 }]);
    expect(recorded.sendComplete).toEqual([{ kind: "audio", delayMs: 15 }]);
    expect(recorded.failures).toEqual([]);
  });

  it("reports source-content A/V offset instead of only packet PTS", () => {
    const { tracker, recorded } = makeHarness();
    tracker.recordVideoSource({
      contentTimeMs: 100,
      availableAtMs: 1000,
    });
    tracker.recordAudioSource({
      pcmBytes: 882 * 2 * 2,
      contentEndMs: 20,
      availableAtMs: 1000,
    });

    tracker.onPacketReady({ kind: "audio", ptsMs: 0, durationMs: 20 });
    tracker.onPacketReady({ kind: "video", ptsMs: 0, durationMs: 100 / 3 });

    expect(recorded.avOffsets).toEqual([100]);
  });

  it("carries input correlation from an evicted frame to the next visible frame", () => {
    const { tracker, recorded, advance } = makeHarness();
    tracker.recordDroppedVideoSource({
      contentTimeMs: 100,
      availableAtMs: 1000,
      inputReceivedAtMs: 900,
    });
    tracker.recordVideoSource({
      contentTimeMs: 133,
      availableAtMs: 1100,
    });

    advance(200);
    tracker.onPacketReady({ kind: "video", ptsMs: 100, durationMs: 33 });

    expect(recorded.inputPacketReady).toEqual([300]);
    expect(recorded.packetReady).toEqual([{ kind: "video", delayMs: 100 }]);
  });

  it("reports missing source and mismatched send PTS without misattribution", () => {
    const { tracker, recorded } = makeHarness();
    tracker.onPacketReady({ kind: "video", ptsMs: 0, durationMs: 100 / 3 });
    tracker.onSendStats(sendStats("video", 33));
    tracker.onSendStats(sendStats("audio", 0));

    expect(recorded.failures).toEqual([
      "video:missing_source",
      "video:pts_mismatch",
      "audio:missing_send",
    ]);
    expect(recorded.sendComplete).toEqual([]);
  });
});
