// The playout-delay RTP header extension sets the ceiling a receiver may use
// for its jitter buffer, so it is close to a floor on client-side latency for
// an interactive stream. These tests pin the encoding and, importantly, that
// omitting the option leaves existing consumers on the historical 100ms.
import { describe, expect, it } from "bun:test";
import { mergePlayStreamOptions } from "../src/media/newApi.js";

describe("videoPlayoutDelayMaxMs option resolution", () => {
  it("defaults to undefined so the packetizer keeps its 100ms behavior", () => {
    expect(mergePlayStreamOptions({}).videoPlayoutDelayMaxMs).toBeUndefined();
  });

  it("passes an explicit value through", () => {
    expect(
      mergePlayStreamOptions({ videoPlayoutDelayMaxMs: 30 })
        .videoPlayoutDelayMaxMs,
    ).toBe(30);
  });

  it("preserves an explicit 0 (ask the receiver not to buffer)", () => {
    // 0 is a meaningful request, not "unset" — a falsy-guard would drop it.
    expect(
      mergePlayStreamOptions({ videoPlayoutDelayMaxMs: 0 })
        .videoPlayoutDelayMaxMs,
    ).toBe(0);
  });

  it("falls back to the default for non-finite values", () => {
    expect(
      mergePlayStreamOptions({ videoPlayoutDelayMaxMs: Number.NaN })
        .videoPlayoutDelayMaxMs,
    ).toBeUndefined();
    expect(
      mergePlayStreamOptions({ videoPlayoutDelayMaxMs: Number.POSITIVE_INFINITY })
        .videoPlayoutDelayMaxMs,
    ).toBeUndefined();
  });

  it("leaves every other play option untouched", () => {
    const merged = mergePlayStreamOptions({ videoPlayoutDelayMaxMs: 30 });
    expect(merged.type).toBe("go-live");
    expect(merged.format).toBe("nut");
    expect(merged.streamPreview).toBe(false);
    expect(merged.readrateInitialBurst).toBeUndefined();
  });
});
