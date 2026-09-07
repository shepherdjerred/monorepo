import { describe, expect, test } from "vitest";
import {
  DiscordOpusFrameDecoder,
  DiscordOpusFrameEncoder,
} from "@shepherdjerred/voice-assistant";
import {
  VoiceAudioMixer,
  type OpusFrameDecoder,
  type OpusFrameEncoder,
} from "@shepherdjerred/streambot/streamer/voice-audio-mixer.ts";
import { FRAME_SAMPLE_COUNT } from "@shepherdjerred/streambot/streamer/audio-frame-mix.ts";

/**
 * The mixer's tests assert **absolute** sample levels, never ratios between them.
 *
 * That is a direct lesson from the fork work, where a codec test compared scale-free Goertzel power
 * ratios: a uniform attenuation — exactly the failure a gain-applying mixer can introduce — leaves
 * every ratio in that test intact while making the track inaudible. Every level assertion below
 * therefore names the number the samples must actually have, and several of them additionally
 * assert the number they must NOT have, so that stubbing the code under test fails the test rather
 * than passing it vacuously.
 */

const MUSIC_LEVEL = 0.4;
const ASSISTANT_LEVEL = 0.3;
/** Simulated cost of one send, charged to the virtual clock so pacing drift is measurable. */
const SEND_WORK_MS = 3;

function constantFrame(
  level: number,
  length = FRAME_SAMPLE_COUNT,
): Float32Array {
  return new Float32Array(length).fill(level);
}

/**
 * The fake codec is a lossless byte view of the samples, which is the point: with a real Opus
 * round trip every level assertion would need a tolerance wide enough to hide a real gain bug.
 * One test at the bottom uses the real codecs to prove the mixer drives them correctly.
 */
function toFakeOpus(samples: Float32Array): Uint8Array {
  return new Uint8Array(new Float32Array(samples).buffer);
}

function fromFakeOpus(opus: Uint8Array): Float32Array {
  return new Float32Array(new Uint8Array(opus).buffer);
}

function rms(samples: Float32Array): number {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}

function peak(samples: Float32Array): number {
  let highest = 0;
  for (const sample of samples) highest = Math.max(highest, Math.abs(sample));
  return highest;
}

class FakeDecoder implements OpusFrameDecoder {
  decodeCount = 0;
  closed = false;
  constructor(private readonly override?: Float32Array) {}
  decode(opus: Uint8Array): Float32Array {
    this.decodeCount += 1;
    return this.override ?? fromFakeOpus(opus);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeEncoder implements OpusFrameEncoder {
  encodeCount = 0;
  closed = false;
  encode(samples: Float32Array): Uint8Array[] {
    this.encodeCount += 1;
    return [toFakeOpus(samples)];
  }
  close(): void {
    this.closed = true;
  }
}

type SentFrame = { readonly frame: Buffer; readonly frametimeMs: number };

class FakeConnection {
  readonly sent: SentFrame[] = [];
  readonly speaking: boolean[] = [];
  accept = true;
  workMs = 0;
  private readonly tick: (ms: number) => void;

  constructor(
    tick: (ms: number) => void = () => {
      /* no clock to advance */
    },
  ) {
    this.tick = tick;
  }

  setSpeaking(value: boolean): void {
    this.speaking.push(value);
  }

  readonly webRtcConn = {
    sendAudioFrame: (frame: Buffer, frametimeMs: number): boolean => {
      this.tick(this.workMs);
      if (!this.accept) return false;
      this.sent.push({ frame, frametimeMs });
      return true;
    },
  };
}

/** Virtual time. Nothing in these tests observes the wall clock, so nothing here can flake on CI. */
function virtualClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
    sleep: (ms: number) => {
      nowMs += ms;
      return Promise.resolve();
    },
  };
}

type Harness = ReturnType<typeof harness>;

function harness(
  options: {
    readonly decoderOverride?: Float32Array;
    readonly sendStallAfterMs?: number;
  } = {},
) {
  const clock = virtualClock();
  const connection = new FakeConnection(clock.advance);
  const decoders: FakeDecoder[] = [];
  const encoders: FakeEncoder[] = [];
  let watchdogTick: (() => void) | null = null;
  const mixer = new VoiceAudioMixer({
    connection: () => connection,
    musicBitrateBps: 128_000,
    now: clock.now,
    sleep: clock.sleep,
    createDecoder: () => {
      const decoder = new FakeDecoder(options.decoderOverride);
      decoders.push(decoder);
      return decoder;
    },
    createEncoder: () => {
      const encoder = new FakeEncoder();
      encoders.push(encoder);
      return encoder;
    },
    startWatchdog: (tick) => {
      watchdogTick = tick;
      return () => {
        watchdogTick = null;
      };
    },
    ...(options.sendStallAfterMs === undefined
      ? {}
      : { sendStallAfterMs: options.sendStallAfterMs }),
  });
  return {
    mixer,
    connection,
    clock,
    decoders,
    encoders,
    fireWatchdog: () => {
      if (watchdogTick === null) throw new Error("watchdog is not running");
      watchdogTick();
    },
  };
}

function lastDecoded(harnessed: Harness): Float32Array {
  const last = harnessed.connection.sent.at(-1);
  if (last === undefined) throw new Error("nothing was sent");
  return fromFakeOpus(last.frame);
}

/**
 * A ducked segment: music playing, the assistant claiming the flag, one assistant packet offered
 * and one music frame driving the mix. Shared because the interesting differences between these
 * tests are what the connection does and what the mix contains, not how the segment is built.
 */
function duckedMix(context: ReturnType<typeof harness>) {
  const assistant = context.mixer.openAssistantAudio();
  const port = context.mixer.openMusicPort();
  assistant.setSpeaking(true);
  const pending = assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
  port.sendAudioFrame(Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))), 20);
  return { assistant, port, pending };
}

describe("VoiceAudioMixer passthrough", () => {
  test("forwards the exact music frame and its frametime at unity gain", () => {
    const context = harness();
    const port = context.mixer.openMusicPort();
    const frame = Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL)));

    expect(port.sendAudioFrame(frame, 17.5)).toBe(true);

    expect(context.connection.sent).toHaveLength(1);
    // Identity, not equality: passthrough must hand the transport the very buffer the demuxer
    // produced. A re-encode that happened to round-trip losslessly would still fail this.
    expect(context.connection.sent[0]?.frame).toBe(frame);
    // The demuxer's frametime survives. A mix-mode emit would have replaced it with a hard 20.
    expect(context.connection.sent[0]?.frametimeMs).toBe(17.5);
  });

  test("decodes every frame but encodes none, so the decoder is warm before the first duck", () => {
    const context = harness();
    const port = context.mixer.openMusicPort();
    for (let index = 0; index < 5; index += 1) {
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        20,
      );
    }

    expect(context.decoders).toHaveLength(1);
    expect(context.decoders[0]?.decodeCount).toBe(5);
    expect(context.encoders).toHaveLength(0);
    expect(context.connection.sent).toHaveLength(5);
  });
});

describe("VoiceAudioMixer gain", () => {
  test("attenuation reaches the samples at the level asked for", () => {
    const context = harness();
    // Set before the port opens, exactly as `streamOnce` does, so the very first frame of a
    // segment already carries the requested level.
    context.mixer.setDesiredVolume(50);
    const port = context.mixer.openMusicPort();

    expect(
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        17.5,
      ),
    ).toBe(true);

    const emitted = lastDecoded(context);
    expect(emitted).toHaveLength(FRAME_SAMPLE_COUNT);
    // Absolute levels. `0.2` is the only value a working 50% gain on a 0.4 source can produce;
    // it is neither the input level nor silence, so neither a stubbed mixer nor a doubled gain
    // passes.
    expect(peak(emitted)).toBeCloseTo(MUSIC_LEVEL * 0.5, 6);
    expect(rms(emitted)).toBeCloseTo(MUSIC_LEVEL * 0.5, 6);
    expect(rms(emitted)).toBeGreaterThan(0.15);
    expect(rms(emitted)).toBeLessThan(MUSIC_LEVEL);
    // A re-encoded frame is always 20 ms regardless of what the demuxer reported.
    expect(context.connection.sent).toHaveLength(1);
    expect(context.connection.sent[0]?.frametimeMs).toBe(20);
    expect(context.encoders[0]?.encodeCount).toBe(1);
  });

  test("setVolume reports success only while a music segment owns the track", () => {
    const context = harness();
    expect(context.mixer.setVolume(50)).toBe(false);
    const port = context.mixer.openMusicPort();
    expect(context.mixer.setVolume(50)).toBe(true);
    port.close();
    expect(context.mixer.setVolume(50)).toBe(false);
  });
});

describe("VoiceAudioMixer mixing", () => {
  test("sums ducked music with assistant speech, one emit per input frame", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    assistant.setSpeaking(true);

    const pending = assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    expect(
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        20,
      ),
    ).toBe(true);
    await pending;

    // 0.4 music × 0.2 duck + 0.3 assistant. Every term is load-bearing: dropping the duck gives
    // 0.7, dropping the assistant gives 0.08, and dropping the mix entirely gives 0.4.
    const expected = MUSIC_LEVEL * 0.2 + ASSISTANT_LEVEL;
    const emitted = lastDecoded(context);
    expect(peak(emitted)).toBeCloseTo(expected, 6);
    expect(rms(emitted)).toBeCloseTo(expected, 6);
    expect(rms(emitted)).toBeGreaterThan(0.3);
    // One music frame in, one frame out — so the RTP timestamp advances exactly once.
    expect(
      context.connection.sent.filter((sent) => sent.frametimeMs === 20),
    ).toHaveLength(1);
    expect(context.connection.sent).toHaveLength(1);
  });

  test("an assistant underrun mixes silence, never a repeat of the previous packet", async () => {
    const context = harness();
    const { port, pending } = duckedMix(context);
    await pending;
    const withAssistant = rms(lastDecoded(context));

    // Second music frame, nothing pending from the assistant.
    port.sendAudioFrame(
      Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
      20,
    );
    const withoutAssistant = lastDecoded(context);

    const duckedOnly = MUSIC_LEVEL * 0.2;
    expect(peak(withoutAssistant)).toBeCloseTo(duckedOnly, 6);
    expect(rms(withoutAssistant)).toBeCloseTo(duckedOnly, 6);
    // Explicitly NOT the previous frame's level: a mixer that repeated the last assistant packet
    // to fill the gap would land on `withAssistant` here and this is the only assertion that says so.
    expect(rms(withoutAssistant)).toBeLessThan(withAssistant - 0.2);
    expect(context.connection.sent).toHaveLength(2);
  });
});

describe("VoiceAudioMixer assistant pacing", () => {
  test("accumulates no drift over thousands of packets", async () => {
    const packets = 5000;
    const context = harness();
    context.connection.workMs = SEND_WORK_MS;
    const assistant = context.mixer.openAssistantAudio();
    assistant.setSpeaking(true);

    for (let index = 0; index < packets; index += 1) {
      await assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    }

    // A rolling deadline makes the total a function of the packet count alone: the send cost is
    // absorbed by the following sleep rather than added to it. The first packet's own send is the
    // single unavoidable offset.
    expect(context.clock.now()).toBe(20 * packets + SEND_WORK_MS);
    // What the old `Bun.sleep(20)` loop would have reached — 15 seconds late over this reply.
    const flatSleepTotal = (20 + SEND_WORK_MS) * packets;
    expect(context.clock.now()).toBeLessThan(flatSleepTotal);
    expect(context.connection.sent).toHaveLength(packets);
    expect(
      context.connection.sent.every((sent) => sent.frametimeMs === 20),
    ).toBe(true);
  });

  test("forwards a solo assistant packet byte-for-byte with no codec involved", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    const opus = toFakeOpus(constantFrame(ASSISTANT_LEVEL));

    await assistant.send(opus);

    expect(context.connection.sent).toHaveLength(1);
    expect([...(context.connection.sent[0]?.frame ?? [])]).toEqual([...opus]);
    expect(context.decoders).toHaveLength(0);
    expect(context.encoders).toHaveLength(0);
  });

  test("resolves rather than deadlocking when the music clock never consumes the packet", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    context.mixer.openMusicPort();
    assistant.setSpeaking(true);

    // No music frame is ever delivered — the pipeline is starting up, seeking, or stalled.
    await assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));

    expect(context.connection.sent).toHaveLength(1);
    expect(
      rms(fromFakeOpus(context.connection.sent[0]?.frame ?? Buffer.alloc(0))),
    ).toBeCloseTo(ASSISTANT_LEVEL, 6);
  });

  test("a teardown mid-reply drains the waiting packet instead of sending it late", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    context.mixer.openMusicPort();
    assistant.setSpeaking(true);

    const pending = assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    context.mixer.reset();
    await expect(pending).resolves.toBeUndefined();
    expect(context.connection.sent).toHaveLength(0);
  });

  test("closing one assistant port leaves another port's queued packet alone", async () => {
    const context = harness();
    const first = context.mixer.openAssistantAudio();
    const second = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    first.setSpeaking(true);

    const pending = first.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    // An unrelated sender goes away — a local feedback clip finishing while a reply is mid-flight.
    second.close();
    port.sendAudioFrame(
      Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
      20,
    );
    await pending;

    expect(peak(lastDecoded(context))).toBeCloseTo(
      MUSIC_LEVEL * 0.2 + ASSISTANT_LEVEL,
      6,
    );
    expect(context.connection.sent).toHaveLength(1);
  });

  test("closing the owning port does abandon its queued packet", async () => {
    // The control for the ownership tag above: without it the two tests are indistinguishable and
    // a tag that matched nothing (or everything) would pass both.
    const context = harness();
    const first = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    first.setSpeaking(true);

    const pending = first.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    first.close();
    port.sendAudioFrame(
      Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
      20,
    );
    await pending;

    // Music alone at unity — the reply's packet was dropped with the port that owned it, and the
    // duck went with it.
    expect(context.connection.sent).toHaveLength(1);
    expect(peak(lastDecoded(context))).toBeCloseTo(MUSIC_LEVEL, 6);
  });

  test("a refused frame is reported to the sender rather than silently lost", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    context.connection.accept = false;

    await expect(
      assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL))),
    ).rejects.toThrow("refused");
  });

  test("a refused MIXED frame is reported too, not just a solo one", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    assistant.setSpeaking(true);
    context.connection.accept = false;

    // The packet is consumed by the music clock rather than sent on its own, so the sender is no
    // longer waiting on its own emit. Without the outcome being reported back, consumption looks
    // identical to delivery and `PacedAssistantSender` completes a reply nobody heard — the same
    // silent success the solo path above already refuses, one layer deeper.
    const pending = assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    port.sendAudioFrame(
      Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
      20,
    );
    await expect(pending).rejects.toThrow("refused");
  });

  test("a mixed frame the connection accepts still resolves", async () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    assistant.setSpeaking(true);

    // The control: reporting the outcome must not reject a delivery that worked, or every ducked
    // reply would be counted as failed while the test above stayed green.
    const pending = assistant.send(toFakeOpus(constantFrame(ASSISTANT_LEVEL)));
    port.sendAudioFrame(
      Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
      20,
    );
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("VoiceAudioMixer speaking arbitration", () => {
  test("music raises the flag once and the assistant never raises a second", () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    const port = context.mixer.openMusicPort();
    expect(context.connection.speaking).toEqual([true]);

    assistant.setSpeaking(true);
    expect(context.connection.speaking).toEqual([true]);

    // The bug this fixes: the assistant clearing the flag at the end of its reply used to drop the
    // green ring in the middle of a song.
    assistant.setSpeaking(false);
    expect(context.connection.speaking).toEqual([true]);

    port.close();
    expect(context.connection.speaking).toEqual([true, false]);
  });

  test("a track change does not blink the flag between segments", () => {
    const context = harness();
    context.mixer.openMusicPort();
    const second = context.mixer.openMusicPort();
    expect(context.connection.speaking).toEqual([true]);
    second.close();
    expect(context.connection.speaking).toEqual([true, false]);
  });

  test("an assistant reply with no music owns the flag for its own duration", () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    assistant.setSpeaking(true);
    assistant.setSpeaking(false);
    expect(context.connection.speaking).toEqual([true, false]);
  });

  test("closing an assistant port releases a speaking claim it still held", () => {
    const context = harness();
    const assistant = context.mixer.openAssistantAudio();
    assistant.setSpeaking(true);
    assistant.close();
    expect(context.connection.speaking).toEqual([true, false]);
  });
});

describe("VoiceAudioMixer port ownership", () => {
  test("a superseded port can no longer write to the connection", () => {
    const context = harness();
    const first = context.mixer.openMusicPort();
    const second = context.mixer.openMusicPort();
    const frame = Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL)));

    expect(first.sendAudioFrame(frame, 20)).toBe(false);
    expect(second.sendAudioFrame(frame, 20)).toBe(true);
    expect(context.connection.sent).toHaveLength(1);
  });

  test("a closed port can no longer write to the connection", () => {
    const context = harness();
    const port = context.mixer.openMusicPort();
    port.close();
    expect(
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        20,
      ),
    ).toBe(false);
    expect(context.connection.sent).toHaveLength(0);
  });
});

describe("VoiceAudioMixer send-side stall watchdog", () => {
  test("raises when frames arrive but none reach the connection", () => {
    const stalls: number[] = [];
    const context = harness({ sendStallAfterMs: 5000 });
    const port = context.mixer.openMusicPort({
      onSendStall: () => stalls.push(context.clock.now()),
    });
    context.connection.accept = false;

    const frame = Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL)));
    expect(port.sendAudioFrame(frame, 20)).toBe(false);
    context.clock.advance(6000);
    port.sendAudioFrame(frame, 20);
    context.fireWatchdog();

    expect(stalls).toHaveLength(1);
  });

  test("stays silent when ffmpeg simply stopped producing", () => {
    const stalls: number[] = [];
    const context = harness({ sendStallAfterMs: 5000 });
    context.mixer.openMusicPort({
      onSendStall: () => stalls.push(context.clock.now()),
    });

    // No frames offered at all. This is an ffmpeg-side stall, which the ffmpeg progress watchdog
    // owns — firing here too would give a music segment a second, much shorter stall timeout than
    // a video one, and would recover from a slow startup as though the transport were broken.
    context.clock.advance(60_000);
    context.fireWatchdog();
    context.fireWatchdog();

    expect(stalls).toEqual([]);
  });

  test("stays silent while frames are landing", () => {
    const stalls: number[] = [];
    const context = harness({ sendStallAfterMs: 5000 });
    const port = context.mixer.openMusicPort({
      onSendStall: () => stalls.push(context.clock.now()),
    });

    const frame = Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL)));
    for (let index = 0; index < 500; index += 1) {
      port.sendAudioFrame(frame, 20);
      context.clock.advance(20);
      context.fireWatchdog();
    }

    expect(stalls).toEqual([]);
    expect(context.connection.sent).toHaveLength(500);
  });
});

describe("VoiceAudioMixer contract guards", () => {
  test("a wrong-sized decode is dropped in mix mode rather than sent", () => {
    const context = harness({
      decoderOverride: new Float32Array(100).fill(0.5),
    });
    context.mixer.setDesiredVolume(50);
    const port = context.mixer.openMusicPort();

    expect(
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        20,
      ),
    ).toBe(false);
    expect(context.connection.sent).toHaveLength(0);
  });

  test("the same wrong-sized decode does not disturb passthrough", () => {
    // The control for the guard above. Passthrough forwards the original bytes and never looks at
    // the decoded sample count, so a frame-size check that fired here would break the ordinary
    // music path while every mix-mode test stayed green.
    const context = harness({
      decoderOverride: new Float32Array(100).fill(0.5),
    });
    const port = context.mixer.openMusicPort();

    expect(
      port.sendAudioFrame(
        Buffer.from(toFakeOpus(constantFrame(MUSIC_LEVEL))),
        20,
      ),
    ).toBe(true);
    expect(context.connection.sent).toHaveLength(1);
  });
});

const FRAMES = 8;

/** A continuous 440 Hz tone at 48 kHz stereo, sliced into consecutive 20 ms frames. */
function toneFrames(amplitude: number): Float32Array[] {
  const perChannel = FRAME_SAMPLE_COUNT / 2;
  return Array.from({ length: FRAMES }, (_unused, frame) => {
    const samples = new Float32Array(FRAME_SAMPLE_COUNT);
    for (let index = 0; index < perChannel; index += 1) {
      const position = frame * perChannel + index;
      const value =
        amplitude * Math.sin((2 * Math.PI * 440 * position) / 48_000);
      samples[index * 2] = value;
      samples[index * 2 + 1] = value;
    }
    return samples;
  });
}

/**
 * Encode a whole sequence through ONE encoder, as ffmpeg would.
 *
 * Encoding each frame with a fresh encoder would make every packet the first packet of its own
 * stream, and libopus's priming means a first packet decodes to a ramp rather than to the tone.
 * The same reasoning is why the assertions below read the LAST frame out: the mixer's decode and
 * re-encode are both continuous streams too, and only steady state says anything about the mix.
 */
function encodeSequence(frames: readonly Float32Array[]): Uint8Array[] {
  const encoder = new DiscordOpusFrameEncoder(128_000);
  try {
    return frames.flatMap((frame) => encoder.encode(frame));
  } finally {
    encoder.close();
  }
}

function decodeSequence(packets: readonly Uint8Array[]): Float32Array[] {
  const decoder = new DiscordOpusFrameDecoder();
  try {
    return packets.map((packet) => decoder.decode(packet));
  } finally {
    decoder.close();
  }
}

/** The real-codec tests never exercise the watchdog, so its canceller does nothing. */
function stopWatchdog(): void {
  /* nothing to cancel */
}

function realHarness() {
  const connection = new FakeConnection();
  const mixer = new VoiceAudioMixer({
    connection: () => connection,
    musicBitrateBps: 128_000,
    now: () => 0,
    sleep: () => Promise.resolve(),
    startWatchdog: () => stopWatchdog,
  });
  return { connection, mixer };
}

describe("VoiceAudioMixer with the real Opus codecs", () => {
  test("passthrough at unity is still byte-identical through the real decoder", () => {
    const { connection, mixer } = realHarness();
    const port = mixer.openMusicPort();
    const packets = encodeSequence(toneFrames(0.5));

    for (const packet of packets) {
      expect(port.sendAudioFrame(Buffer.from(packet), 20)).toBe(true);
    }
    port.close();

    expect(connection.sent).toHaveLength(packets.length);
    for (const [index, sent] of connection.sent.entries()) {
      expect([...sent.frame]).toEqual([...(packets[index] ?? [])]);
    }
  });

  test("a ducked mix comes back out above an absolute loudness floor", async () => {
    const { connection, mixer } = realHarness();
    const assistant = mixer.openAssistantAudio();
    const port = mixer.openMusicPort();
    assistant.setSpeaking(true);

    // Deliberately different amplitudes. With both at the same level the correct mix would be
    // numerically close to "music only" and to "assistant only", and a stubbed mixFrame would slip
    // through the level bounds below. At 0.5 and 0.7 the four candidate outcomes — correct mix
    // (0.8), music only (0.5), assistant only (0.7), un-ducked sum (1.2, clamped to 1.0) — are all
    // separated by more than the codec's error.
    const musicPackets = encodeSequence(toneFrames(0.5));
    const assistantPackets = encodeSequence(toneFrames(0.7));
    for (const [index, musicPacket] of musicPackets.entries()) {
      const assistantPacket = assistantPackets[index];
      if (assistantPacket === undefined) throw new Error("missing packet");
      const pending = assistant.send(assistantPacket);
      expect(port.sendAudioFrame(Buffer.from(musicPacket), 20)).toBe(true);
      await pending;
    }
    port.close();

    expect(connection.sent).toHaveLength(musicPackets.length);
    const decoded = decodeSequence(connection.sent.map((sent) => sent.frame));
    const steadyState = decoded.at(-1);
    if (steadyState === undefined) throw new Error("nothing was sent");

    expect(steadyState).toHaveLength(FRAME_SAMPLE_COUNT);
    // 0.5 music × 0.2 duck + 0.7 assistant, in phase, is a 0.8-amplitude tone: RMS ≈ 0.566.
    // The bounds are ABSOLUTE and two-sided. A uniform attenuation anywhere in this chain — the
    // exact failure a ratio-based assertion cannot see — falls out of them, and so does every one
    // of the three wrong mixes named above.
    expect(rms(steadyState)).toBeGreaterThan(0.52);
    expect(rms(steadyState)).toBeLessThan(0.61);
    expect(peak(steadyState)).toBeGreaterThan(0.72);
    expect(peak(steadyState)).toBeLessThan(0.88);
  });

  test("music alone at unity, mixed only because the volume is down, keeps its level", () => {
    const { connection, mixer } = realHarness();
    mixer.setDesiredVolume(50);
    const port = mixer.openMusicPort();

    for (const packet of encodeSequence(toneFrames(0.8))) {
      expect(port.sendAudioFrame(Buffer.from(packet), 20)).toBe(true);
    }
    port.close();

    const decoded = decodeSequence(connection.sent.map((sent) => sent.frame));
    const steadyState = decoded.at(-1);
    if (steadyState === undefined) throw new Error("nothing was sent");
    // 0.8 × 0.5 = 0.4 amplitude, RMS ≈ 0.28. Bounded on BOTH sides: too loud means the gain never
    // reached the samples, too quiet means it was applied twice.
    expect(rms(steadyState)).toBeGreaterThan(0.2);
    expect(rms(steadyState)).toBeLessThan(0.36);
    expect(peak(steadyState)).toBeGreaterThan(0.3);
    expect(peak(steadyState)).toBeLessThan(0.5);
  });
});
