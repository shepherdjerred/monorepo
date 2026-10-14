import { wire } from "./wire.generated.ts";

export type PacketKind = keyof typeof wire.kinds;
export type RuntimePacket = {
  kind: PacketKind;
  sequence: number;
  timeMs: number;
  payload: Uint8Array;
};
export type RuntimeHeader = Omit<RuntimePacket, "payload"> & { length: number };

export function encodePacket(packet: RuntimePacket): Uint8Array<ArrayBuffer> {
  if (
    !Number.isInteger(packet.sequence) ||
    packet.sequence < 0 ||
    packet.sequence > 0xff_ff_ff_ff
  )
    throw new Error("Invalid runtime sequence");
  if (!Number.isFinite(packet.timeMs) || packet.timeMs < 0)
    throw new Error("Invalid runtime clock");
  if (packet.payload.length > wire.limits[packet.kind])
    throw new Error("Runtime packet is too large");
  const bytes = new Uint8Array(wire.headerBytes + packet.payload.length);
  bytes.set(wire.magic);
  const view = new DataView(bytes.buffer);
  view.setUint32(wire.offsets.kind, wire.kinds[packet.kind], true);
  view.setUint32(wire.offsets.length, packet.payload.length, true);
  view.setUint32(wire.offsets.sequence, packet.sequence, true);
  view.setFloat64(wire.offsets.timeMs, packet.timeMs, true);
  bytes.set(packet.payload, wire.headerBytes);
  return bytes;
}

export function decodePacket(bytes: Uint8Array): RuntimePacket {
  const header = decodeHeader(bytes);
  if (bytes.length !== wire.headerBytes + header.length)
    throw new Error("Invalid runtime packet length");
  return {
    kind: header.kind,
    sequence: header.sequence,
    timeMs: header.timeMs,
    payload: bytes.subarray(wire.headerBytes),
  };
}

export function decodeHeader(bytes: Uint8Array): RuntimeHeader {
  if (
    bytes.length < wire.headerBytes ||
    wire.magic.some((value, index) => bytes[index] !== value)
  )
    throw new Error("Invalid runtime packet header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = Object.entries(wire.kinds).find(
    ([_name, value]) => value === view.getUint32(wire.offsets.kind, true),
  );
  if (declared === undefined) throw new Error("Unknown runtime packet kind");
  return readHeader(packetKind(declared[0]), view);
}

function readHeader(kind: PacketKind, view: DataView): RuntimeHeader {
  const length = view.getUint32(wire.offsets.length, true);
  const timeMs = view.getFloat64(wire.offsets.timeMs, true);
  if (length > wire.limits[kind])
    throw new Error("Invalid runtime packet length");
  if (!Number.isFinite(timeMs) || timeMs < 0)
    throw new Error("Invalid runtime clock");
  return {
    kind,
    sequence: view.getUint32(wire.offsets.sequence, true),
    timeMs,
    length,
  };
}

function packetKind(name: string): PacketKind {
  switch (name) {
    case "hello":
    case "video":
    case "audio":
    case "telemetry":
    case "error":
    case "saved":
    case "input":
    case "flush":
    case "stop":
      return name;
    default:
      throw new Error("Unknown runtime packet kind");
  }
}
