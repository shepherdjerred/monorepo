import { describe, expect, it } from "vitest";
import {
  getReplayTransportLayout,
  getReplayContainerLayout,
  MAX_REPLAY_CHUNK_BYTES,
  normalizeGameBuild,
  readReplayChunkHeader,
  ReplayTransportError,
  sameGameBuild,
} from "./replay-transport.mjs";

describe("build-specific replay transport", () => {
  it("retains observed legacy storage without admitting unverified packet semantics", () => {
    for (const [build, protocol] of [
      ["16.18.817.5716", "f6a10af08504a7ee"],
      ["16.19.823.0722", "6bfab33e871a4a58"],
      ["16.20.824.8524", "142cabd45e45d83f"],
    ] as const) {
      expect(getReplayContainerLayout(build, protocol).chunkHeaderBytes).toBe(
        17,
      );
      expect(() => getReplayTransportLayout(build, protocol)).toThrow(
        "Unsupported transport",
      );
    }
    expect(() =>
      getReplayContainerLayout("16.22.834.8910", "20e09df23c66b85e"),
    ).toThrow("transport admission is preparing");
  });
  it.each(["16.23.839.9929", "16.23.840.6595"])(
    "admits the observed %s container without enabling browser decoding",
    (build) => {
      const protocol = "8bbfcd5af2bc92db";
      expect(getReplayContainerLayout(build, protocol)).toMatchObject({
        build,
        protocol,
        chunkHeaderBytes: 18,
        compressionTag: 4,
      });
      expect(() => getReplayTransportLayout(build, protocol)).toThrow(
        expect.objectContaining({ code: "unsupported-transport" }),
      );
      expect(() => getReplayContainerLayout(build, "20e09df23c66b85e")).toThrow(
        "Unsupported container protocol",
      );
    },
  );

  it("does not admit an unobserved sibling build with the same protocol", () => {
    const protocol = "8bbfcd5af2bc92db";
    expect(() => getReplayContainerLayout("16.23.840.6596", protocol)).toThrow(
      "transport admission is preparing",
    );
  });
  it("normalizes all four numeric version components without admitting other formats", () => {
    expect(normalizeGameBuild("16.14.794.05912")).toBe("16.14.794.5912");
    expect(sameGameBuild("16.14.794.05912", "16.14.794.5912")).toBe(true);
    for (const invalid of [
      "16.14",
      "16.14.794",
      "16.14.794.5912x",
      "",
      "1e1.14.794.5912",
    ])
      expect(normalizeGameBuild(invalid)).toBeNull();
    expect(sameGameBuild("invalid", "invalid")).toBe(false);
    expect(sameGameBuild("16.14.794.5912", "16.14.795.5912")).toBe(false);
  });

  it("requires an observed build and protocol pair, including future patches", () => {
    expect(
      getReplayTransportLayout("16.14.794.05912", "509c49fd988fca11")
        .chunkHeaderBytes,
    ).toBe(17);
    expect(
      getReplayTransportLayout("16.21.829.8620", "20e09df23c66b85e")
        .chunkHeaderBytes,
    ).toBe(18);
    for (const [build, protocol] of [
      ["16.22.834.8910", "20e09df23c66b85e"],
      ["16.21.829.8620", "509c49fd988fca11"],
      ["16.14.794.5912", "20e09df23c66b85e"],
    ] as const) {
      expect(() => getReplayTransportLayout(build, protocol)).toThrow(
        ReplayTransportError,
      );
      try {
        getReplayTransportLayout(build, protocol);
      } catch (error) {
        expect(error).toMatchObject({ code: "unsupported-transport" });
      }
    }
  });

  for (const [build, protocol] of [
    ["16.14.794.5912", "509c49fd988fca11"],
    ["16.21.829.8620", "20e09df23c66b85e"],
  ] as const) {
    const layout = getReplayTransportLayout(build, protocol);
    const header = (rawSize = 17, compressedSize = 0) => {
      const bytes = new Uint8Array(layout.chunkHeaderBytes);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 19, true);
      view.setUint32(5, 4 << 24, true);
      view.setUint32(9, rawSize, true);
      view.setUint32(13, compressedSize, true);
      if (layout.chunkHeaderBytes === 18) bytes[17] = 4;
      return bytes;
    };

    it(`${build} reads its header with both compressed and uncompressed bodies`, () => {
      expect(readReplayChunkHeader(header(), layout)).toEqual({
        chunkId: 19,
        stream: 4,
        rawSize: 17,
        compressedSize: 0,
        storedSize: 17,
        compressionTag: layout.compressionTag,
      });
      expect(readReplayChunkHeader(header(17, 23), layout)).toMatchObject({
        rawSize: 17,
        compressedSize: 23,
        storedSize: 23,
      });
      expect(
        readReplayChunkHeader(header(MAX_REPLAY_CHUNK_BYTES), layout).rawSize,
      ).toBe(MAX_REPLAY_CHUNK_BYTES);
    });

    it(`${build} rejects truncated headers, invalid streams and unsafe sizes`, () => {
      expect(() => readReplayChunkHeader(header().subarray(1), layout)).toThrow(
        "Truncated chunk header",
      );
      for (const bytes of [
        header(0),
        header(MAX_REPLAY_CHUNK_BYTES + 1),
        header(17, MAX_REPLAY_CHUNK_BYTES + 1),
      ])
        expect(() => readReplayChunkHeader(bytes, layout)).toThrow(
          "Invalid chunk header",
        );
      for (const streamTag of [0, 5 << 24, (1 << 24) | 1]) {
        const bytes = header();
        new DataView(bytes.buffer).setUint32(5, streamTag, true);
        expect(() => readReplayChunkHeader(bytes, layout)).toThrow(
          "Invalid chunk header",
        );
      }
      if (layout.chunkHeaderBytes === 18) {
        const bytes = header();
        bytes[17] = 3;
        expect(() => readReplayChunkHeader(bytes, layout)).toThrow(
          "Unsupported chunk compression tag 3",
        );
      }
    });
  }
});
