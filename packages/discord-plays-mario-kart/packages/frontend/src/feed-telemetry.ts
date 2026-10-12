// Driver-feed latency telemetry shared by the game view (which measures) and the
// controller's ping loop (which reports).
//
// The HUD clock burned into each frame is the server's wall clock, so reading it
// against `Date.now()` is only as good as the two clocks' agreement. The ping
// ack carries the server's clock; Cristian's estimate from the lowest-RTT recent
// ping bounds the offset error by half that RTT.

/** Recent pings to pick the best offset estimate from. */
const OFFSET_WINDOW = 8;
/** Samples held between reports; the report schema caps the array at 64. */
const MAX_PENDING_SAMPLES = 64;

type OffsetSample = { readonly rttMs: number; readonly offsetMs: number };

export type FeedTelemetryReport = {
  readonly glassMs: number[];
  readonly decoderResets: number;
};

export class FeedTelemetry {
  private readonly offsets: OffsetSample[] = [];
  private glassSamples: number[] = [];
  private decoderResets = 0;

  /**
   * Record one ping round trip. `serverNowMs` is the server's clock when it
   * acked; `receivedAtMs` is this page's clock when the ack arrived.
   */
  recordPing(
    sentAtMs: number,
    receivedAtMs: number,
    serverNowMs: number,
  ): void {
    const rttMs = receivedAtMs - sentAtMs;
    this.offsets.push({
      rttMs,
      offsetMs: serverNowMs + rttMs / 2 - receivedAtMs,
    });
    if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
  }

  /** Server clock minus page clock, or 0 before the first ping. */
  get clockOffsetMs(): number {
    let best: OffsetSample | undefined;
    for (const sample of this.offsets) {
      if (best === undefined || sample.rttMs < best.rttMs) best = sample;
    }
    return best?.offsetMs ?? 0;
  }

  /** The page's clock expressed on the server's timeline. */
  serverNow(pageNowMs: number): number {
    return pageNowMs + this.clockOffsetMs;
  }

  recordGlass(glassMs: number): void {
    if (this.glassSamples.length >= MAX_PENDING_SAMPLES) return;
    this.glassSamples.push(glassMs);
  }

  recordDecoderReset(): void {
    this.decoderResets += 1;
  }

  /** Hand over everything measured since the last drain. */
  drain(): FeedTelemetryReport {
    const report = {
      glassMs: this.glassSamples,
      decoderResets: this.decoderResets,
    };
    this.glassSamples = [];
    this.decoderResets = 0;
    return report;
  }
}

export const feedTelemetry = new FeedTelemetry();
