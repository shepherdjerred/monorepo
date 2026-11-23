/** Construct a tiny synthetic container for storage validation tests. */
export function buildReplayContainerFixture(input: {
  headerVersion: string;
  protocol: string;
  gameLength: number;
  participants: readonly Record<string, string>[];
  chunkHeaderBytes?: 17 | 18;
  compressionTag?: number;
  compressed?: boolean;
}): Uint8Array<ArrayBuffer> {
  const version = Buffer.from(input.headerVersion, "ascii");
  const header = Buffer.alloc(15);
  header.write("RIOT", 0, "ascii");
  header.writeUInt16LE(2, 4);
  Buffer.from(input.protocol, "hex").copy(header, 6);
  header[14] = version.byteLength;
  const chunkHeader = Buffer.alloc(input.chunkHeaderBytes ?? 17);
  chunkHeader.writeUInt32LE(1, 0);
  chunkHeader[4] = 1;
  chunkHeader.writeUInt32LE(0x04_00_00_00, 5);
  chunkHeader.writeUInt32LE(1, 9);
  const compressed = input.compressed === true;
  const body = compressed
    ? Bun.zstdCompressSync(Buffer.from([0]))
    : Buffer.from([0]);
  if (compressed) chunkHeader.writeUInt32LE(body.byteLength, 13);
  if (chunkHeader.byteLength === 18)
    chunkHeader[17] = input.compressionTag ?? 4;
  const metadata = Buffer.from(
    JSON.stringify({
      gameLength: input.gameLength,
      lastGameChunkId: 1,
      lastKeyFrameId: 0,
      statsJson: JSON.stringify(input.participants),
    }),
  );
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32LE(metadata.byteLength);
  return Buffer.concat([
    header,
    version,
    chunkHeader,
    body,
    Buffer.alloc(256, 1),
    metadata,
    metadataLength,
  ]);
}
