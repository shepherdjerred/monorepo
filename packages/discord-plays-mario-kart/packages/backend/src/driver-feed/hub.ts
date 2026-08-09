// Fan-out of encoded access units to the connected drivers.
//
// One encode serves everyone; the hub decides, per client, which units that
// client can actually use. Two rules, both expressed through a single
// `needsKeyframe` flag:
//
//   1. A client that has just connected has no decoder state, so it must start
//      at a decoder entry point (IDR + SPS + PPS) — deltas before that would
//      decode into garbage.
//   2. A client whose socket backlog exceeds the ceiling gets deltas dropped and
//      is put back into state 1. This bound is the whole point: the Go-Live path
//      once queued 3.47 GB of frames against a 4 GiB pod limit by letting a slow
//      consumer accumulate (archive/completed/2026-06-19_mk64-stream-backpressure.md).
//
// A joining client therefore waits up to one keyframe interval (~1 s at the
// defaults) for its first picture. Buffering the in-flight GOP would remove that
// wait, but replaying it would make the client decode a second of video as fast
// as it can before settling — lower `keyframe_interval_frames` if the wait
// matters more than the bitrate the extra IDRs cost.

import {
  DRIVER_FEED_KEYFRAME_FLAG,
  DRIVER_FEED_HEADER_BYTES,
} from "@discord-plays-mario-kart/common";
import {
  driverFeedClientBufferBytes,
  driverFeedClients,
  driverFeedUnitsDroppedTotal,
  driverFeedUnitsSentTotal,
} from "#src/observability/metrics.ts";
import type { AccessUnit } from "./annex-b.ts";

/**
 * Prefix the one-byte header the client needs to classify the chunk. Built once
 * per unit and shared by every client, so fan-out stays a single copy.
 */
export function frameDriverFeedMessage(unit: AccessUnit): Buffer {
  const header = Buffer.alloc(DRIVER_FEED_HEADER_BYTES);
  header[0] = unit.isDecoderEntryPoint ? DRIVER_FEED_KEYFRAME_FLAG : 0;
  return Buffer.concat([header, unit.bytes]);
}

/**
 * The hub's view of a connected driver. Implemented over `ws` in production and
 * by a fake in tests — the hub never touches a socket directly.
 */
export type FeedClient = {
  /** Bytes accepted but not yet flushed to the network (`ws.bufferedAmount`). */
  readonly bufferedBytes: number;
  send: (payload: Buffer) => void;
  close: (reason: string) => void;
};

export type DriverFeedHubOptions = {
  readonly maxClients: number;
  readonly maxClientBufferBytes: number;
};

type ClientState = {
  /** True until the client has been sent a unit it can cold-start decoding from. */
  needsKeyframe: boolean;
};

export class DriverFeedHub {
  private readonly options: DriverFeedHubOptions;
  private readonly clients = new Map<FeedClient, ClientState>();

  constructor(options: DriverFeedHubOptions) {
    this.options = options;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Register a client. Returns false when the viewer cap is already reached —
   * the caller is expected to close the socket with an explanation.
   */
  add(client: FeedClient): boolean {
    if (this.clients.size >= this.options.maxClients) return false;
    this.clients.set(client, { needsKeyframe: true });
    driverFeedClients.set(this.clients.size);
    return true;
  }

  remove(client: FeedClient): void {
    if (this.clients.delete(client)) {
      driverFeedClients.set(this.clients.size);
    }
  }

  /** Require every connected client to cold-start at the next stream entry point. */
  resetAllToKeyframe(): void {
    for (const state of this.clients.values()) {
      state.needsKeyframe = true;
    }
  }

  /** Offer one access unit to every client that can currently use it. */
  broadcast(unit: AccessUnit): void {
    if (this.clients.size === 0) return;
    const payload = frameDriverFeedMessage(unit);
    let peakBuffered = 0;
    for (const [client, state] of this.clients) {
      const buffered = client.bufferedBytes;
      peakBuffered = Math.max(peakBuffered, buffered);

      if (buffered > this.options.maxClientBufferBytes) {
        // Falling behind. Stop feeding this client until it can restart cleanly,
        // so its backlog drains instead of growing.
        state.needsKeyframe = true;
        driverFeedUnitsDroppedTotal.inc({ reason: "backpressure" });
        continue;
      }
      if (state.needsKeyframe) {
        if (!unit.isDecoderEntryPoint) {
          driverFeedUnitsDroppedTotal.inc({ reason: "awaiting_keyframe" });
          continue;
        }
        state.needsKeyframe = false;
      }
      client.send(payload);
      driverFeedUnitsSentTotal.inc();
    }
    driverFeedClientBufferBytes.set(peakBuffered);
  }

  /** Drop every client (session teardown). */
  closeAll(reason: string): void {
    for (const client of this.clients.keys()) {
      client.close(reason);
    }
    this.clients.clear();
    driverFeedClients.set(0);
    driverFeedClientBufferBytes.set(0);
  }
}
