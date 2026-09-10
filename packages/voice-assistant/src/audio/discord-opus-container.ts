const MAGIC = new TextEncoder().encode("SBDOPUS\0");
const HEADER_BYTES = 16;
const FORMAT_VERSION = 1;
export const DISCORD_OPUS_FRAME_MS = 20;

export type DiscordOpusContainer = {
  readonly packets: readonly Uint8Array[];
  readonly durationMs: number;
};

function matchesMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC.byteLength) return false;
  return MAGIC.every((value, index) => bytes[index] === value);
}

export function encodeDiscordOpusContainer(
  packets: readonly Uint8Array[],
): Uint8Array {
  if (packets.length === 0) throw new Error("Discord Opus container is empty");
  const bodyBytes = packets.reduce((total, packet) => {
    if (packet.byteLength === 0 || packet.byteLength > 65_535) {
      throw new Error(
        `Invalid Discord Opus packet length ${String(packet.byteLength)}`,
      );
    }
    return total + 2 + packet.byteLength;
  }, 0);
  const output = new Uint8Array(HEADER_BYTES + bodyBytes);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint16(8, FORMAT_VERSION, true);
  view.setUint16(10, DISCORD_OPUS_FRAME_MS, true);
  view.setUint32(12, packets.length, true);
  let offset = HEADER_BYTES;
  for (const packet of packets) {
    view.setUint16(offset, packet.byteLength, true);
    offset += 2;
    output.set(packet, offset);
    offset += packet.byteLength;
  }
  return output;
}

export function decodeDiscordOpusContainer(
  bytes: Uint8Array,
): DiscordOpusContainer {
  if (bytes.byteLength < HEADER_BYTES || !matchesMagic(bytes)) {
    throw new Error("Invalid Streambot Discord Opus container magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported Discord Opus container version ${String(version)}`,
    );
  }
  const frameMs = view.getUint16(10, true);
  if (frameMs !== DISCORD_OPUS_FRAME_MS) {
    throw new Error(
      `Discord Opus frame duration must be ${String(DISCORD_OPUS_FRAME_MS)}ms`,
    );
  }
  const packetCount = view.getUint32(12, true);
  if (packetCount === 0) throw new Error("Discord Opus container is empty");
  const packets: Uint8Array[] = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < packetCount; index += 1) {
    if (offset + 2 > bytes.byteLength) {
      throw new Error("Truncated Discord Opus packet length");
    }
    const length = view.getUint16(offset, true);
    offset += 2;
    if (length === 0 || offset + length > bytes.byteLength) {
      throw new Error("Truncated or empty Discord Opus packet");
    }
    packets.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.byteLength) {
    throw new Error("Discord Opus container has trailing bytes");
  }
  return {
    packets,
    durationMs: packets.length * DISCORD_OPUS_FRAME_MS,
  };
}
