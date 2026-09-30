const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) throw new Error("Invalid WAV header text");
    view.setUint8(offset + index, codePoint);
  }
}

/** Encode the exact mono Float32 samples consumed by voice detection as a PCM16 WAV. */
export function encodePcm16MonoWave(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  return encodePcm16MonoWaveBytes(encodePcm16Samples(samples), sampleRate);
}

export function encodePcm16Samples(samples: Float32Array): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (const [index, rawSample] of samples.entries()) {
    const sample = Math.max(-1, Math.min(1, rawSample));
    view.setInt16(
      index * 2,
      Math.round(sample < 0 ? sample * 32_768 : sample * 32_767),
      true,
    );
  }
  return pcm;
}

export function encodePcm16MonoWaveBytes(
  pcm: Uint8Array,
  sampleRate: number,
): Uint8Array {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error("PCM16 audio must contain complete samples");
  }
  const dataBytes = pcm.byteLength;
  const wav = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

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
