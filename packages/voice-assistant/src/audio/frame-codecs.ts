/**
 * The 48 kHz stereo Opus pair used to mix two audio sources onto one Discord voice track.
 *
 * Separate from `codecs.ts`, which holds the assistant's codecs: those convert between Discord's
 * wire format and OpenAI's 24 kHz mono PCM, so their resamplers are fixed to that shape. These two
 * stay in Discord's own format end to end — decode to interleaved float, scale, sum, re-encode —
 * because a mixer that resampled on the way through would degrade audio it is only attenuating.
 */

import type { CodecContext } from "node-av";
import {
  AV_CHANNEL_LAYOUT_STEREO,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  AVERROR_EAGAIN,
  AVERROR_EOF,
  FFmpegError,
  Frame,
  SoftwareResampleContext,
} from "node-av";
import {
  DISCORD_CHANNELS,
  DISCORD_FRAME_SAMPLES,
  DISCORD_SAMPLE_RATE,
  bytesFromFloat32,
  concatFloat32,
  createOpusContext,
  decodeOpusPacket,
  receiveOpusPackets,
} from "./codecs.ts";

/**
 * Opus → 48 kHz **stereo interleaved** float: Discord's own wire layout, kept end to end.
 *
 * Distinct from {@link DiscordOpusDecoder}, which downmixes to the 16 kHz mono the wake-word
 * detector consumes. Mixing audio back onto the wire needs the samples at the wire's rate and
 * layout — any resample on the way in would have to be undone on the way out, and the round trip
 * costs quality for nothing. The libav Opus decoder emits planar float (FLTP), so the resampler
 * here is a pure FLTP → FLT interleave at the same rate and layout, which is close to free.
 */
export class DiscordOpusFrameDecoder {
  private readonly context = createOpusContext("decoder");
  private readonly resampler = new SoftwareResampleContext();

  public constructor() {
    FFmpegError.throwIfError(
      this.resampler.allocSetOpts2(
        AV_CHANNEL_LAYOUT_STEREO,
        AV_SAMPLE_FMT_FLT,
        DISCORD_SAMPLE_RATE,
        AV_CHANNEL_LAYOUT_STEREO,
        AV_SAMPLE_FMT_FLTP,
        DISCORD_SAMPLE_RATE,
      ),
      "configure Discord frame resampler",
    );
    FFmpegError.throwIfError(
      this.resampler.init(),
      "initialize Discord frame resampler",
    );
  }

  /** One Opus packet in, its samples out as `[L, R, L, R, …]` at 48 kHz. */
  public decode(opus: Uint8Array): Float32Array {
    return decodeOpusPacket({
      context: this.context,
      resampler: this.resampler,
      opus,
      allocateOutput: (nbSamples) =>
        Frame.fromAudioBuffer(Buffer.alloc(nbSamples * DISCORD_CHANNELS * 4), {
          format: AV_SAMPLE_FMT_FLT,
          nbSamples,
          sampleRate: DISCORD_SAMPLE_RATE,
          channelLayout: AV_CHANNEL_LAYOUT_STEREO,
        }),
      label: "interleave Discord frame audio",
    });
  }

  public close(): void {
    this.resampler.free();
    this.context.freeContext();
  }
}

/**
 * 48 kHz stereo interleaved float → Opus, with **no resampler at all**.
 *
 * The mirror of {@link DiscordOpusFrameDecoder}: samples that were decoded from the wire and
 * modified in place (gain, mixing) go straight back out at the rate and layout they already have.
 * {@link DiscordOpusEncoder} cannot serve this — its resampler is hardwired to the assistant's
 * 24 kHz mono PCM16 input — and a resampler that converts 48 kHz stereo to 48 kHz stereo would be
 * pure overhead on every frame.
 *
 * Input is buffered into whole 20 ms (960-sample-per-channel) frames, the size libopus is opened
 * with. Feed it exactly one decoded 20 ms frame and it emits exactly one packet, which is what a
 * mixer sitting in the send path needs to keep RTP timestamps continuous.
 */
export class DiscordOpusFrameEncoder {
  private readonly context: CodecContext;
  private pending = new Float32Array();

  /** @param bitRate Target bit rate in bits per second (e.g. `128_000` for music). */
  public constructor(bitRate: number) {
    this.context = createOpusContext("encoder", bitRate);
  }

  public encode(samples: Float32Array): Uint8Array[] {
    if (samples.length % DISCORD_CHANNELS !== 0)
      throw new Error(
        `Interleaved stereo PCM must hold both channels of every sample, got ${String(samples.length)} values`,
      );
    const frameLength = DISCORD_FRAME_SAMPLES * DISCORD_CHANNELS;
    // Cursor-based drain, for the same reason DiscordOpusEncoder uses one: re-slicing the tail per
    // frame is O(n²) when a caller hands over a large block at once.
    const buffered = concatFloat32([this.pending, samples]);
    const packets: Uint8Array[] = [];
    let offset = 0;
    while (buffered.length - offset >= frameLength) {
      packets.push(
        ...this.encodeFrame(buffered.subarray(offset, offset + frameLength)),
      );
      offset += frameLength;
    }
    this.pending = buffered.slice(offset);
    return packets;
  }

  /** Pad any partial trailing frame with silence, flush the encoder, and drain it. */
  public finish(): Uint8Array[] {
    const packets: Uint8Array[] = [];
    if (this.pending.length > 0) {
      const padded = new Float32Array(DISCORD_FRAME_SAMPLES * DISCORD_CHANNELS);
      padded.set(this.pending);
      this.pending = new Float32Array();
      packets.push(...this.encodeFrame(padded));
    }
    const flushResult = this.context.sendFrameSync(null);
    if (
      flushResult !== AVERROR_EOF &&
      flushResult !== AVERROR_EAGAIN &&
      flushResult < 0
    ) {
      FFmpegError.throwIfError(flushResult, "flush music Opus encoder");
    }
    packets.push(
      ...receiveOpusPackets(this.context, "receive music Opus packet"),
    );
    return packets;
  }

  private encodeFrame(samples: Float32Array): Uint8Array[] {
    const frame = Frame.fromAudioBuffer(
      Buffer.from(bytesFromFloat32(samples)),
      {
        format: AV_SAMPLE_FMT_FLT,
        nbSamples: DISCORD_FRAME_SAMPLES,
        sampleRate: DISCORD_SAMPLE_RATE,
        channelLayout: AV_CHANNEL_LAYOUT_STEREO,
      },
    );
    try {
      FFmpegError.throwIfError(
        this.context.sendFrameSync(frame),
        "encode music Opus frame",
      );
    } finally {
      frame.free();
    }
    return receiveOpusPackets(this.context, "receive music Opus packet");
  }

  public close(): void {
    this.context.freeContext();
  }
}
