import {
  AV_CHANNEL_LAYOUT_MONO,
  AV_CHANNEL_LAYOUT_STEREO,
  AV_CODEC_ID_OPUS,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  AVERROR_EAGAIN,
  AVERROR_EOF,
  Codec,
  CodecContext,
  FFmpegError,
  Frame,
  Packet,
  SoftwareResampleContext,
} from "node-av";

const DISCORD_SAMPLE_RATE = 48_000;
const DISCORD_CHANNELS = 2;
const DISCORD_FRAME_SAMPLES = 960;
const OPENAI_SAMPLE_RATE = 24_000;
const WAKE_SAMPLE_RATE = 16_000;

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function float32FromBytes(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error("Invalid float PCM length");
  const result = new Float32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * 4, true);
  }
  return result;
}

function bytesFromFloat32(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(index * 4, samples[index] ?? 0, true);
  }
  return bytes;
}

function createOpusContext(kind: "decoder" | "encoder"): CodecContext {
  const codec =
    kind === "decoder"
      ? Codec.findDecoder(AV_CODEC_ID_OPUS)
      : Codec.findEncoder(AV_CODEC_ID_OPUS);
  if (codec === null) throw new Error(`libav ${kind} for Opus is unavailable`);
  const context = new CodecContext();
  context.allocContext3(codec);
  context.sampleRate = DISCORD_SAMPLE_RATE;
  context.channelLayout = AV_CHANNEL_LAYOUT_STEREO;
  if (kind === "encoder") {
    context.sampleFormat = AV_SAMPLE_FMT_FLT;
    context.bitRate = 64_000n;
  }
  FFmpegError.throwIfError(context.open2Sync(codec), `open Opus ${kind}`);
  return context;
}

export class DiscordOpusDecoder {
  private readonly context = createOpusContext("decoder");
  private readonly resampler = new SoftwareResampleContext();

  public constructor() {
    FFmpegError.throwIfError(
      this.resampler.allocSetOpts2(
        AV_CHANNEL_LAYOUT_MONO,
        AV_SAMPLE_FMT_FLT,
        WAKE_SAMPLE_RATE,
        AV_CHANNEL_LAYOUT_STEREO,
        AV_SAMPLE_FMT_FLTP,
        DISCORD_SAMPLE_RATE,
      ),
      "configure Discord voice resampler",
    );
    FFmpegError.throwIfError(
      this.resampler.init(),
      "initialize Discord voice resampler",
    );
  }

  public decode(opus: Uint8Array): Float32Array {
    const packet = new Packet();
    packet.alloc();
    packet.data = Buffer.from(opus);
    const outputs: Uint8Array[] = [];
    try {
      FFmpegError.throwIfError(
        this.context.sendPacketSync(packet),
        "decode Opus packet",
      );
      while (true) {
        const frame = new Frame();
        frame.alloc();
        const receiveResult = this.context.receiveFrameSync(frame);
        if (receiveResult === AVERROR_EAGAIN || receiveResult === AVERROR_EOF) {
          frame.free();
          break;
        }
        FFmpegError.throwIfError(receiveResult, "receive decoded Opus frame");
        const outputSamples = this.resampler.getOutSamples(frame.nbSamples);
        const output = Frame.fromAudioBuffer(Buffer.alloc(outputSamples * 4), {
          format: AV_SAMPLE_FMT_FLT,
          nbSamples: outputSamples,
          sampleRate: WAKE_SAMPLE_RATE,
          channelLayout: AV_CHANNEL_LAYOUT_MONO,
        });
        try {
          FFmpegError.throwIfError(
            this.resampler.convertFrame(output, frame),
            "resample Discord voice audio",
          );
          outputs.push(output.toBuffer());
        } finally {
          output.free();
          frame.free();
        }
      }
    } finally {
      packet.free();
    }
    return float32FromBytes(concatBytes(outputs));
  }

  public close(): void {
    this.resampler.free();
    this.context.freeContext();
  }
}

export function wakePcmToOpenAiPcm(samples: Float32Array): Uint8Array {
  if (samples.length === 0) return new Uint8Array();
  const resampler = new SoftwareResampleContext();
  const input = Frame.fromAudioBuffer(Buffer.from(bytesFromFloat32(samples)), {
    format: AV_SAMPLE_FMT_FLT,
    nbSamples: samples.length,
    sampleRate: WAKE_SAMPLE_RATE,
    channelLayout: AV_CHANNEL_LAYOUT_MONO,
  });
  try {
    FFmpegError.throwIfError(
      resampler.allocSetOpts2(
        AV_CHANNEL_LAYOUT_MONO,
        AV_SAMPLE_FMT_S16,
        OPENAI_SAMPLE_RATE,
        AV_CHANNEL_LAYOUT_MONO,
        AV_SAMPLE_FMT_FLT,
        WAKE_SAMPLE_RATE,
      ),
      "configure OpenAI input resampler",
    );
    FFmpegError.throwIfError(
      resampler.init(),
      "initialize OpenAI input resampler",
    );
    const outputSamples = resampler.getOutSamples(input.nbSamples);
    const output = Frame.fromAudioBuffer(Buffer.alloc(outputSamples * 2), {
      format: AV_SAMPLE_FMT_S16,
      nbSamples: outputSamples,
      sampleRate: OPENAI_SAMPLE_RATE,
      channelLayout: AV_CHANNEL_LAYOUT_MONO,
    });
    try {
      FFmpegError.throwIfError(
        resampler.convertFrame(output, input),
        "resample OpenAI input audio",
      );
      return output.toBuffer();
    } finally {
      output.free();
    }
  } finally {
    input.free();
    resampler.free();
  }
}

export class DiscordOpusEncoder {
  private readonly context = createOpusContext("encoder");
  private readonly resampler = new SoftwareResampleContext();
  private pendingPcm: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private pendingFloat: Uint8Array<ArrayBufferLike> = new Uint8Array();

  public constructor() {
    FFmpegError.throwIfError(
      this.resampler.allocSetOpts2(
        AV_CHANNEL_LAYOUT_STEREO,
        AV_SAMPLE_FMT_FLT,
        DISCORD_SAMPLE_RATE,
        AV_CHANNEL_LAYOUT_MONO,
        AV_SAMPLE_FMT_S16,
        OPENAI_SAMPLE_RATE,
      ),
      "configure assistant voice resampler",
    );
    FFmpegError.throwIfError(
      this.resampler.init(),
      "initialize assistant voice resampler",
    );
  }

  public encode(pcm24k: Uint8Array): Uint8Array[] {
    // Cursor-based drain: re-slicing the remaining buffer per 20 ms frame copies the whole tail
    // every iteration — O(n²) when a caller enqueues a large clip at once. resample() copies its
    // input into an ffmpeg frame buffer, so subarray views are safe here.
    const buffered = concatBytes([this.pendingPcm, pcm24k]);
    const inputBytesPerFrame = (OPENAI_SAMPLE_RATE / 50) * 2;
    const packets: Uint8Array[] = [];
    let offset = 0;
    while (buffered.byteLength - offset >= inputBytesPerFrame) {
      const inputBytes = buffered.subarray(offset, offset + inputBytesPerFrame);
      offset += inputBytesPerFrame;
      this.pendingFloat = concatBytes([
        this.pendingFloat,
        this.resample(inputBytes),
      ]);
      packets.push(...this.encodeAvailableFrames());
    }
    this.pendingPcm = buffered.slice(offset);
    return packets;
  }

  public finish(): Uint8Array[] {
    if (this.pendingPcm.byteLength > 0) {
      const frameBytes = (OPENAI_SAMPLE_RATE / 50) * 2;
      const padded = new Uint8Array(frameBytes);
      padded.set(this.pendingPcm);
      this.pendingPcm = new Uint8Array();
      this.pendingFloat = concatBytes([
        this.pendingFloat,
        this.resample(padded),
      ]);
    }
    const outputFrameBytes = DISCORD_FRAME_SAMPLES * DISCORD_CHANNELS * 4;
    if (this.pendingFloat.byteLength > 0) {
      const paddedLength =
        Math.ceil(this.pendingFloat.byteLength / outputFrameBytes) *
        outputFrameBytes;
      const padded = new Uint8Array(paddedLength);
      padded.set(this.pendingFloat);
      this.pendingFloat = padded;
    }
    const packets = this.encodeAvailableFrames();
    const flushResult = this.context.sendFrameSync(null);
    if (
      flushResult < 0 &&
      flushResult !== AVERROR_EOF &&
      flushResult !== AVERROR_EAGAIN
    ) {
      FFmpegError.throwIfError(flushResult, "flush assistant Opus encoder");
    }
    packets.push(...this.receivePackets());
    return packets;
  }

  private resample(pcm: Uint8Array): Uint8Array {
    const input = Frame.fromAudioBuffer(Buffer.from(pcm), {
      format: AV_SAMPLE_FMT_S16,
      nbSamples: pcm.byteLength / 2,
      sampleRate: OPENAI_SAMPLE_RATE,
      channelLayout: AV_CHANNEL_LAYOUT_MONO,
    });
    const outputSamples = this.resampler.getOutSamples(input.nbSamples);
    const output = Frame.fromAudioBuffer(
      Buffer.alloc(outputSamples * DISCORD_CHANNELS * 4),
      {
        format: AV_SAMPLE_FMT_FLT,
        nbSamples: outputSamples,
        sampleRate: DISCORD_SAMPLE_RATE,
        channelLayout: AV_CHANNEL_LAYOUT_STEREO,
      },
    );
    try {
      FFmpegError.throwIfError(
        this.resampler.convertFrame(output, input),
        "resample assistant voice audio",
      );
      return output.toBuffer();
    } finally {
      output.free();
      input.free();
    }
  }

  private encodeAvailableFrames(): Uint8Array[] {
    const frameBytes = DISCORD_FRAME_SAMPLES * DISCORD_CHANNELS * 4;
    const packets: Uint8Array[] = [];
    let offset = 0;
    while (this.pendingFloat.byteLength - offset >= frameBytes) {
      const input = this.pendingFloat.subarray(offset, offset + frameBytes);
      offset += frameBytes;
      const frame = Frame.fromAudioBuffer(Buffer.from(input), {
        format: AV_SAMPLE_FMT_FLT,
        nbSamples: DISCORD_FRAME_SAMPLES,
        sampleRate: DISCORD_SAMPLE_RATE,
        channelLayout: AV_CHANNEL_LAYOUT_STEREO,
      });
      try {
        FFmpegError.throwIfError(
          this.context.sendFrameSync(frame),
          "encode assistant Opus frame",
        );
      } finally {
        frame.free();
      }
      packets.push(...this.receivePackets());
    }
    if (offset > 0) this.pendingFloat = this.pendingFloat.slice(offset);
    return packets;
  }

  private receivePackets(): Uint8Array[] {
    const packets: Uint8Array[] = [];
    while (true) {
      const packet = new Packet();
      packet.alloc();
      const receiveResult = this.context.receivePacketSync(packet);
      if (receiveResult === AVERROR_EAGAIN || receiveResult === AVERROR_EOF) {
        packet.free();
        break;
      }
      try {
        FFmpegError.throwIfError(
          receiveResult,
          "receive assistant Opus packet",
        );
        const data = packet.data;
        if (data === null)
          throw new Error("Opus encoder returned an empty packet");
        packets.push(Uint8Array.from(data));
      } finally {
        packet.free();
      }
    }
    return packets;
  }

  public close(): void {
    this.resampler.free();
    this.context.freeContext();
  }
}
