import type { MemoryReader } from "./memory.ts";
import type { CardinalDirection } from "./engine-observation.ts";

export const ENGINE_MAP_TOPOLOGY_VERSION = 1;
export const ENGINE_MAP_TOPOLOGY_SIZE = 28;
export const ENGINE_MAP_CONNECTION_SIZE = 24;
export const ENGINE_MAP_WARP_SIZE = 24;
export const ENGINE_MAP_OFFSET = 7;

export type EngineMapConnectionDirection =
  | CardinalDirection
  | "dive"
  | "emerge";
export type EngineMapWarpActivation =
  | CardinalDirection
  | "step"
  | "unsupported";

export type EngineMapTopologyHeaderV1 = Readonly<{
  version: 1;
  size: 28;
  frame: number;
  mapGroup: number;
  mapNum: number;
  width: number;
  height: number;
  bounds: Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }>;
  warpCount: number;
  connectionCount: number;
}>;

export type EngineMapConnectionV1 = Readonly<{
  version: 1;
  size: 24;
  index: number;
  direction: EngineMapConnectionDirection;
  destination: Readonly<{
    mapGroup: number;
    mapNum: number;
  }>;
  offset: number;
  span: Readonly<{
    start: Readonly<{ x: number; y: number }>;
    end: Readonly<{ x: number; y: number }>;
  }> | null;
}>;

export type EngineMapWarpV1 = Readonly<{
  version: 1;
  size: 24;
  index: number;
  trigger: Readonly<{
    x: number;
    y: number;
    elevation: number;
    behavior: number;
  }>;
  activation: EngineMapWarpActivation;
  destination: Readonly<{
    mapGroup: number;
    mapNum: number;
    warpId: number;
    dynamic: boolean;
    landing: Readonly<{ x: number; y: number }> | null;
  }>;
}>;

export type EngineMapTopologyV1 = Readonly<{
  version: 1;
  size: 28;
  frame: number;
  mapGroup: number;
  mapNum: number;
  width: number;
  height: number;
  bounds: EngineMapTopologyHeaderV1["bounds"];
  connections: readonly EngineMapConnectionV1[];
  warps: readonly EngineMapWarpV1[];
}>;

export type EngineMapTopologyExports = Readonly<{
  readMapTopology: () => number;
  readMapConnection: (index: number) => number;
  readMapWarp: (index: number) => number;
}>;

const MAP_CONNECTION_HAS_SPAN = 1;
const MAP_WARP_DYNAMIC_DESTINATION = 1;
const MAP_WARP_DESTINATION_RESOLVED = 2;

function requireIntegerFunction0(
  exports: Bun.WebAssembly.Exports,
  name: string,
): () => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  return () => {
    const result: unknown = Reflect.apply(value, undefined, []);
    if (typeof result !== "number" || !Number.isInteger(result)) {
      throw new TypeError(`wasm export ${name} did not return an integer`);
    }
    return result;
  };
}

function requireIntegerFunction1(
  exports: Bun.WebAssembly.Exports,
  name: string,
): (argument: number) => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  return (argument) => {
    const result: unknown = Reflect.apply(value, undefined, [argument]);
    if (typeof result !== "number" || !Number.isInteger(result)) {
      throw new TypeError(`wasm export ${name} did not return an integer`);
    }
    return result;
  };
}

export function bindEngineMapTopologyExports(
  exports: Bun.WebAssembly.Exports,
): EngineMapTopologyExports {
  return {
    readMapTopology: requireIntegerFunction0(exports, "WasmReadMapTopology"),
    readMapConnection: requireIntegerFunction1(
      exports,
      "WasmReadMapConnection",
    ),
    readMapWarp: requireIntegerFunction1(exports, "WasmReadMapWarp"),
  };
}

function mapConnectionDirectionFromRaw(
  raw: number,
): EngineMapConnectionDirection {
  switch (raw) {
    case 1:
      return "south";
    case 2:
      return "north";
    case 3:
      return "west";
    case 4:
      return "east";
    case 5:
      return "dive";
    case 6:
      return "emerge";
    default:
      throw new RangeError(`unknown map connection direction: ${String(raw)}`);
  }
}

function mapWarpActivationFromRaw(raw: number): EngineMapWarpActivation {
  switch (raw) {
    case 0:
      return "unsupported";
    case 1:
      return "step";
    case 2:
      return "north";
    case 3:
      return "south";
    case 4:
      return "west";
    case 5:
      return "east";
    default:
      throw new RangeError(`unknown map warp activation: ${String(raw)}`);
  }
}

function topologyView(
  bytes: Uint8Array,
  expectedSize: number,
  structure: string,
): DataView {
  if (bytes.byteLength < expectedSize) {
    throw new RangeError(
      `${structure} is too short: ${String(bytes.byteLength)} bytes`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(0, true);
  const size = view.getUint16(2, true);
  if (version !== ENGINE_MAP_TOPOLOGY_VERSION || size !== expectedSize) {
    throw new Error(
      `unsupported ${structure} ABI: version=${String(version)} size=${String(size)}`,
    );
  }
  return view;
}

export function decodeEngineMapTopologyHeader(
  bytes: Uint8Array,
): EngineMapTopologyHeaderV1 | null {
  const view = topologyView(
    bytes,
    ENGINE_MAP_TOPOLOGY_SIZE,
    "engine map topology",
  );
  const available = view.getUint8(8);
  if (available !== 0 && available !== 1) {
    throw new RangeError(
      `invalid engine map topology availability: ${String(available)}`,
    );
  }
  if (view.getUint8(11) !== 0) {
    throw new RangeError("engine map topology reserved byte is nonzero");
  }
  if (available === 0) return null;

  const width = view.getInt32(12, true);
  const height = view.getInt32(16, true);
  if (width <= 0 || height <= 0) {
    throw new RangeError(
      `invalid engine map dimensions: ${String(width)}x${String(height)}`,
    );
  }
  const warpCount = view.getUint32(20, true);
  if (warpCount > 0xff) {
    throw new RangeError(`invalid engine map warp count: ${String(warpCount)}`);
  }

  return {
    version: ENGINE_MAP_TOPOLOGY_VERSION,
    size: ENGINE_MAP_TOPOLOGY_SIZE,
    frame: view.getUint32(4, true),
    mapGroup: view.getUint8(9),
    mapNum: view.getUint8(10),
    width,
    height,
    bounds: {
      minX: ENGINE_MAP_OFFSET,
      maxX: ENGINE_MAP_OFFSET + width - 1,
      minY: ENGINE_MAP_OFFSET,
      maxY: ENGINE_MAP_OFFSET + height - 1,
    },
    warpCount,
    connectionCount: view.getUint32(24, true),
  };
}

export function decodeEngineMapConnection(
  bytes: Uint8Array,
  expectedIndex: number,
): EngineMapConnectionV1 {
  const view = topologyView(
    bytes,
    ENGINE_MAP_CONNECTION_SIZE,
    "engine map connection",
  );
  const index = view.getUint32(4, true);
  if (index !== expectedIndex) {
    throw new RangeError(
      `engine map connection index mismatch: expected=${String(expectedIndex)} actual=${String(index)}`,
    );
  }
  const direction = mapConnectionDirectionFromRaw(view.getUint8(8));
  const flags = view.getUint8(11);
  if ((flags & ~MAP_CONNECTION_HAS_SPAN) !== 0) {
    throw new RangeError(
      `unknown engine map connection flags: ${String(flags)}`,
    );
  }
  const hasSpan = (flags & MAP_CONNECTION_HAS_SPAN) !== 0;
  if (hasSpan && (direction === "dive" || direction === "emerge")) {
    throw new Error(`${direction} map connection cannot have an edge span`);
  }
  const startX = view.getInt16(16, true);
  const startY = view.getInt16(18, true);
  const endX = view.getInt16(20, true);
  const endY = view.getInt16(22, true);
  if (!hasSpan && (startX !== 0 || startY !== 0 || endX !== 0 || endY !== 0)) {
    throw new Error("spanless engine map connection has nonzero coordinates");
  }

  return {
    version: ENGINE_MAP_TOPOLOGY_VERSION,
    size: ENGINE_MAP_CONNECTION_SIZE,
    index,
    direction,
    destination: {
      mapGroup: view.getUint8(9),
      mapNum: view.getUint8(10),
    },
    offset: view.getInt32(12, true),
    span: hasSpan
      ? {
          start: { x: startX, y: startY },
          end: { x: endX, y: endY },
        }
      : null,
  };
}

export function decodeEngineMapWarp(
  bytes: Uint8Array,
  expectedIndex: number,
): EngineMapWarpV1 {
  const view = topologyView(bytes, ENGINE_MAP_WARP_SIZE, "engine map warp");
  const index = view.getUint32(4, true);
  if (index !== expectedIndex) {
    throw new RangeError(
      `engine map warp index mismatch: expected=${String(expectedIndex)} actual=${String(index)}`,
    );
  }
  const flags = view.getUint8(18);
  const knownFlags =
    MAP_WARP_DYNAMIC_DESTINATION | MAP_WARP_DESTINATION_RESOLVED;
  if ((flags & ~knownFlags) !== 0) {
    throw new RangeError(`unknown engine map warp flags: ${String(flags)}`);
  }
  if (view.getUint8(19) !== 0) {
    throw new RangeError("engine map warp reserved byte is nonzero");
  }
  const dynamic = (flags & MAP_WARP_DYNAMIC_DESTINATION) !== 0;
  const resolved = (flags & MAP_WARP_DESTINATION_RESOLVED) !== 0;
  if (dynamic && resolved) {
    throw new Error("dynamic engine map warp cannot have a resolved landing");
  }
  const destinationX = view.getInt16(20, true);
  const destinationY = view.getInt16(22, true);
  if (!resolved && (destinationX !== 0 || destinationY !== 0)) {
    throw new Error(
      "unresolved engine map warp has nonzero landing coordinates",
    );
  }

  return {
    version: ENGINE_MAP_TOPOLOGY_VERSION,
    size: ENGINE_MAP_WARP_SIZE,
    index,
    trigger: {
      x: view.getInt16(8, true),
      y: view.getInt16(10, true),
      elevation: view.getUint8(12),
      behavior: view.getUint8(13),
    },
    activation: mapWarpActivationFromRaw(view.getUint8(14)),
    destination: {
      mapGroup: view.getUint8(15),
      mapNum: view.getUint8(16),
      warpId: view.getUint8(17),
      dynamic,
      landing: resolved ? { x: destinationX, y: destinationY } : null,
    },
  };
}

export function readEngineMapTopology(
  reader: MemoryReader,
  exports: EngineMapTopologyExports,
): EngineMapTopologyV1 | null {
  const headerPointer = exports.readMapTopology();
  if (headerPointer === 0) {
    throw new Error("wasm map topology export returned a null pointer");
  }
  const header = decodeEngineMapTopologyHeader(
    reader.bytes(headerPointer, ENGINE_MAP_TOPOLOGY_SIZE),
  );
  if (header === null) return null;

  const connections: EngineMapConnectionV1[] = [];
  for (let index = 0; index < header.connectionCount; index += 1) {
    const pointer = exports.readMapConnection(index);
    if (pointer === 0) {
      throw new Error(
        `wasm map connection export returned a null pointer for index ${String(index)}`,
      );
    }
    connections.push(
      decodeEngineMapConnection(
        reader.bytes(pointer, ENGINE_MAP_CONNECTION_SIZE),
        index,
      ),
    );
  }

  const warps: EngineMapWarpV1[] = [];
  for (let index = 0; index < header.warpCount; index += 1) {
    const pointer = exports.readMapWarp(index);
    if (pointer === 0) {
      throw new Error(
        `wasm map warp export returned a null pointer for index ${String(index)}`,
      );
    }
    warps.push(
      decodeEngineMapWarp(reader.bytes(pointer, ENGINE_MAP_WARP_SIZE), index),
    );
  }

  return {
    version: header.version,
    size: header.size,
    frame: header.frame,
    mapGroup: header.mapGroup,
    mapNum: header.mapNum,
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    connections,
    warps,
  };
}
