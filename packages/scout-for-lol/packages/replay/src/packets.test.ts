import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  index: vi.fn(),
  window: vi.fn(),
  next: vi.fn(),
  closed: vi.fn(),
}));
vi.mock("./observations/transport.mjs", () => ({ openReplay: mocks.open }));
vi.mock("./observations/replay-keyframe-index.mjs", () => ({
  buildReplayKeyframeIndex: mocks.index,
}));
vi.mock("./observations/replay-seek-window.mjs", () => ({
  readReplaySeekWindow: mocks.window,
}));
const { createReplayPacketReader } = await import("./packets.ts");
const entry = {
  chunkId: 2,
  chunkOffset: 40,
  storedChunkBytes: 50,
  timeSeconds: 0,
  secondTimeBits: 0,
  predecessorChunkId: 1,
  predecessorStream: 4,
};
const decompressor = (bytes: Uint8Array) => bytes;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockImplementation((buffer: ArrayBuffer) => ({
    bytes: new Uint8Array(buffer),
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    duration: 1,
    durationMilliseconds: 1000,
  }));
  mocks.index.mockReturnValue([entry]);
  mocks.window.mockImplementation(() => ({
    keyframe: entry,
    packets: (function* () {
      try {
        mocks.next();
        yield { timeSeconds: 0, payload: new Uint8Array([1]) };
        mocks.next();
        yield { timeSeconds: 0.5, payload: new Uint8Array([2]) };
      } finally {
        mocks.closed();
      }
    })(),
  }));
});

test("the reader indexes the same borrowed buffer once and never exposes its mutable index", () => {
  const buffer = new ArrayBuffer(64),
    reader = createReplayPacketReader(buffer, decompressor);
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(buffer);
  expect(mocks.index).toHaveBeenCalledOnce();
  expect(reader.durationMilliseconds).toBe(1000);
  expect(reader.durationSeconds).toBe(1);
  expect(reader.keyframes[0]).toEqual(entry);
  expect(reader.keyframes[0]).not.toBe(entry);
  expect(Object.isFrozen(reader.keyframes)).toBe(true);
  expect(Object.isFrozen(reader.keyframes[0])).toBe(true);
  const first = reader.read(0.5),
    second = reader.read(0.75);
  expect(first.keyframe).not.toBe(entry);
  expect(mocks.next).not.toHaveBeenCalled();
  expect([...first.packets]).toHaveLength(2);
  expect([...second.packets]).toHaveLength(2);
  expect(mocks.index).toHaveBeenCalledOnce();
  expect(buffer.byteLength).toBe(64);
});

test("aborting a paused seek prevents another decoder read and preserves the exact reason", () => {
  const reader = createReplayPacketReader(new ArrayBuffer(64), decompressor),
    controller = new AbortController();
  const packets = reader.read(0.5, { signal: controller.signal }).packets;
  expect(packets.next().done).toBe(false);
  expect(mocks.next).toHaveBeenCalledTimes(1);
  const reason = new DOMException("seek replaced", "AbortError");
  controller.abort(reason);
  expect(() => packets.next()).toThrow(reason);
  expect(mocks.next).toHaveBeenCalledTimes(1);
  expect(mocks.closed).toHaveBeenCalledOnce();
  expect([...reader.read(0.5).packets]).toHaveLength(2);
});

test("already aborted and detached-buffer reads fail before touching packet data", () => {
  const buffer = new ArrayBuffer(64),
    reader = createReplayPacketReader(buffer, decompressor),
    controller = new AbortController();
  controller.abort(new Error("cancelled"));
  expect(() => reader.read(0, { signal: controller.signal })).toThrow(
    "cancelled",
  );
  expect(mocks.window).not.toHaveBeenCalled();
  structuredClone(buffer, { transfer: [buffer] });
  expect(() => reader.read(0)).toThrow("detached or resized");
  expect(mocks.window).not.toHaveBeenCalled();
});

test("a caller closing its iterator releases the underlying window", () => {
  const reader = createReplayPacketReader(new ArrayBuffer(64), decompressor),
    packets = reader.read(0).packets;
  packets.next();
  packets.return();
  expect(mocks.closed).toHaveBeenCalledOnce();
  expect(mocks.next).toHaveBeenCalledOnce();
});
