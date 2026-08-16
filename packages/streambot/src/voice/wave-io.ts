/** Strict little PCM16 mono WAV reader for pinned voice assets; throws on anything else. */
export async function readPcm16MonoWave(
  filename: string,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const bytes = new Uint8Array(await Bun.file(filename).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number): string =>
    String.fromCodePoint(...bytes.subarray(offset, offset + length));
  if (
    bytes.byteLength < 44 ||
    ascii(0, 4) !== "RIFF" ||
    ascii(8, 4) !== "WAVE"
  ) {
    throw new Error(`Invalid keyword smoke WAV: ${filename}`);
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let dataOffset: number | null = null;
  let dataLength: number | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkLength > bytes.byteLength) {
      throw new Error(`Invalid keyword smoke WAV chunk: ${filename}`);
    }
    if (chunkId === "fmt ") {
      if (
        chunkLength < 16 ||
        view.getUint16(chunkDataOffset, true) !== 1 ||
        view.getUint16(chunkDataOffset + 2, true) !== 1 ||
        view.getUint16(chunkDataOffset + 14, true) !== 16
      ) {
        throw new Error(`Keyword smoke WAV must be mono PCM16: ${filename}`);
      }
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkLength;
    }
    offset = chunkDataOffset + chunkLength + (chunkLength % 2);
  }
  if (
    sampleRate === null ||
    dataOffset === null ||
    dataLength === null ||
    dataLength % 2 !== 0
  ) {
    throw new Error(`Keyword smoke WAV is incomplete: ${filename}`);
  }

  const samples = new Float32Array(dataLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32_768;
  }
  return { samples, sampleRate };
}
