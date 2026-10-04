import { z } from "zod";

const MAX_PACKET_BYTES = 64 * 1024;
const StatusReplySchema = z.object({
  players: z.object({
    online: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
});

export function encodeVarInt(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7f_ff_ff_ff) {
    throw new Error("Invalid VarInt");
  }
  const bytes: number[] = [];
  do {
    const next = value & 0x7f;
    value >>>= 7;
    bytes.push(next | (value === 0 ? 0 : 0x80));
  } while (value !== 0);
  return Buffer.from(bytes);
}

export function readVarInt(
  bytes: Buffer,
  offset = 0,
): { value: number; next: number } | undefined {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = bytes[offset + index];
    if (byte === undefined) {
      return undefined;
    }
    if (index === 4 && (byte & 0xf8) !== 0) {
      throw new Error("Invalid VarInt");
    }
    value |= (byte & 0x7f) << (index * 7);
    if ((byte & 0x80) === 0) {
      return { value, next: offset + index + 1 };
    }
  }
  throw new Error("Invalid VarInt");
}

export function statusRequest(host: string, port: number): Buffer {
  const address = Buffer.from(host);
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  const handshake = Buffer.concat([
    Buffer.from([0]),
    encodeVarInt(773),
    encodeVarInt(address.length),
    address,
    portBytes,
    Buffer.from([1]),
  ]);
  return Buffer.concat([
    encodeVarInt(handshake.length),
    handshake,
    Buffer.from([1, 0]),
  ]);
}

export function parseStatusPacket(
  bytes: Buffer,
): { online: number; maximum: number } | undefined {
  if (bytes.length > MAX_PACKET_BYTES) {
    throw new Error("Minecraft status packet too large");
  }
  const length = readVarInt(bytes);
  if (length === undefined) {
    return undefined;
  }
  if (length.value > MAX_PACKET_BYTES) {
    throw new Error("Minecraft status packet too large");
  }
  if (bytes.length < length.next + length.value) {
    return undefined;
  }
  const packet = readVarInt(bytes, length.next);
  if (packet?.value !== 0) {
    throw new Error("Unexpected Minecraft packet");
  }
  const stringLength = readVarInt(bytes, packet.next);
  if (
    stringLength === undefined ||
    stringLength.next + stringLength.value !== length.next + length.value
  ) {
    throw new Error("Invalid Minecraft status frame");
  }
  const result = StatusReplySchema.parse(
    JSON.parse(
      bytes
        .subarray(stringLength.next, stringLength.next + stringLength.value)
        .toString("utf8"),
    ),
  );
  return { online: result.players.online, maximum: result.players.max };
}
