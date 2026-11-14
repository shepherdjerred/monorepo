import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { unwrapSportsSegment } from "./segment-payload.ts";
import { sportsPng } from "#sports-png-fixture";

describe("sports segment carriers", () => {
  it.each([0, 1, 2, 3, 4])("reconstructs PNG filter %s", (filter) => {
    const payload = Uint8Array.from({ length: 188 }, (_, index) =>
      index === 0 ? 71 : index,
    );
    expect(unwrapSportsSegment(sportsPng(payload, "KWP1", filter))).toEqual(
      payload,
    );
  });
  it("handles the alternate magic and gzip payload", () => {
    const payload = new TextEncoder().encode("synthetic media");
    expect([
      ...unwrapSportsSegment(sportsPng(gzipSync(payload), "TIKTIKPX")),
    ]).toEqual([...payload]);
  });
  it("keeps ordinary media byte-identical", () => {
    const bytes = new Uint8Array([71, 0, 17, 16]);
    expect(unwrapSportsSegment(bytes)).toBe(bytes);
  });
  it("rejects unknown envelopes, oversized images and truncated chunks", () => {
    expect(() =>
      unwrapSportsSegment(sportsPng(new Uint8Array([1]), "NOPE")),
    ).toThrow("envelope");
    const excessive = sportsPng(new Uint8Array([1]));
    new DataView(excessive.buffer, excessive.byteOffset).setUint32(
      16,
      4_294_967_295,
    );
    expect(() => unwrapSportsSegment(excessive)).toThrow("layout");
    expect(() =>
      unwrapSportsSegment(sportsPng(new Uint8Array([1])).slice(0, 48)),
    ).toThrow("chunk");
  });
});
