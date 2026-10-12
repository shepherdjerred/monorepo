import { describe, expect, it } from "vitest";
import { FeedTelemetry } from "./feed-telemetry.ts";

describe("FeedTelemetry", () => {
  it("reports no offset before the first ping", () => {
    expect(new FeedTelemetry().clockOffsetMs).toBe(0);
  });

  it("estimates the offset from the lowest-RTT ping", () => {
    const telemetry = new FeedTelemetry();
    // Server runs 500 ms ahead. A slow, asymmetric ping gives a worse estimate.
    telemetry.recordPing(0, 200, 650);
    // A 10 ms round trip: the server stamped its clock mid-flight at page 5.
    telemetry.recordPing(1000, 1010, 1505);
    expect(telemetry.clockOffsetMs).toBe(500);
    expect(telemetry.serverNow(2000)).toBe(2500);
  });

  it("forgets pings outside the recent window", () => {
    const telemetry = new FeedTelemetry();
    telemetry.recordPing(0, 2, 101); // best, but about to age out
    for (let i = 1; i <= 8; i++) {
      telemetry.recordPing(i * 1000, i * 1000 + 20, i * 1000 + 10 + 300);
    }
    expect(telemetry.clockOffsetMs).toBe(300);
  });

  it("drains glass samples and decoder resets exactly once", () => {
    const telemetry = new FeedTelemetry();
    telemetry.recordGlass(40);
    telemetry.recordGlass(55);
    telemetry.recordDecoderReset();
    expect(telemetry.drain()).toEqual({ glassMs: [40, 55], decoderResets: 1 });
    expect(telemetry.drain()).toEqual({ glassMs: [], decoderResets: 0 });
  });

  it("caps pending samples at the report schema's limit", () => {
    const telemetry = new FeedTelemetry();
    for (let i = 0; i < 100; i++) telemetry.recordGlass(i);
    expect(telemetry.drain().glassMs).toHaveLength(64);
  });
});
