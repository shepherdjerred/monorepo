import { expect, test } from "vitest";
import { openReplay, replayPacketEnvelopes } from "./transport.mjs";

test("traverses only observed 841 packet envelopes", () => {
  const packet = Uint8Array.of(0xb1, 0, 0, 0, 0, 0, 1, 0x34, 0x12, 7, 42);
  const bytes = new Uint8Array(18 + packet.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(5, 1 << 24, true);
  view.setUint32(9, packet.length, true);
  bytes[17] = 4;
  bytes.set(packet, 18);
  const replay = {
    bytes,
    headerEnd: 0,
    end: bytes.length,
    declaredChunkCount: 1,
    protocol: "8bbfcd5af2bc92db",
  };
  const decompress = () => {
    throw Error("Fixture body is uncompressed");
  };
  for (const build of ["16.23.841.3489", "16.23.841.8428"]) {
    expect([
      ...replayPacketEnvelopes({ ...replay, build }, decompress),
    ]).toEqual([
      expect.objectContaining({
        explicitOpcode: 0x1234,
        paramBits: 7,
        payload: Uint8Array.of(42),
      }),
    ]);
  }
  expect(() =>
    Array.from(
      replayPacketEnvelopes({ ...replay, build: "16.23.841.8429" }, decompress),
    ),
  ).toThrow("Unsupported packet envelope build/protocol");
});

test("a selected startup stream still validates the full chunk count", () => {
  const packet = Uint8Array.of(0xb1, 0, 0, 0, 0, 0, 1, 0xfe, 3, 0, 42);
  const bytes = new Uint8Array(18 + 1 + 18 + packet.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(5, 1 << 24, true);
  view.setUint32(9, 4, true);
  view.setUint32(13, 1, true);
  bytes[17] = 4;
  const startup = 19;
  view.setUint32(startup + 5, 3 << 24, true);
  view.setUint32(startup + 9, packet.length, true);
  bytes[startup + 17] = 4;
  bytes.set(packet, startup + 18);
  const replay = {
    build: "16.23.841.8428",
    protocol: "8bbfcd5af2bc92db",
    bytes,
    headerEnd: 0,
    end: bytes.length,
    declaredChunkCount: 2,
  };
  const decompress = () => {
    throw Error("Unrelated compressed body must remain untouched");
  };
  const selected = { stream: 3 };
  expect([...replayPacketEnvelopes(replay, decompress, selected)]).toEqual([
    expect.objectContaining({ stream: 3, explicitOpcode: 1022 }),
  ]);
  expect(() => [
    ...replayPacketEnvelopes(
      { ...replay, declaredChunkCount: 3 },
      decompress,
      selected,
    ),
  ]).toThrow("Replay chunk count mismatch");
});

function winnerFromFooter(outcomes) {
  const build = Buffer.from("16.23.840.6595");
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = build.length;
  const stats = Array.from({ length: 10 }, (_, index) => ({
    SKIN: `Champion${index}`,
    TEAM: index < 5 ? "100" : "200",
    WIN: outcomes[index],
  }));
  const footer = Buffer.from(
    JSON.stringify({
      gameLength: 1000,
      statsJson: JSON.stringify(stats),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(footer.length);
  const bytes = Uint8Array.from(
    Buffer.concat([header, build, Buffer.alloc(256), footer, length]),
  );
  return openReplay(bytes.buffer).winningTeam;
}

test("replay result requires consistent footer outcomes from both teams", () => {
  const outcomes = [
    "Fail",
    "Fail",
    "LeaverFail",
    "Fail",
    "Fail",
    "Win",
    "Win",
    "Win",
    "Win",
    "Win",
  ];
  expect(winnerFromFooter(outcomes)).toBe(200);
  expect(winnerFromFooter(outcomes.toReversed())).toBe(100);
  expect(winnerFromFooter(["Win", ...outcomes.slice(1)])).toBeNull();
  expect(winnerFromFooter([])).toBeNull();
});
