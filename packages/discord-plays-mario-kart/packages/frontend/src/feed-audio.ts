// Driver-feed audio: s16le PCM chunks in, Web Audio playback out.
//
// Each chunk becomes an AudioBuffer scheduled to start exactly where the
// previous one ends, so consecutive chunks play gaplessly. The playhead runs a
// small lead ahead of the audio clock to absorb network jitter between chunks;
// the video paints with no buffer at all, so this lead is how far the sound
// trails the picture.
//
// Nothing else pulls the lead back down once it grows, and it does grow: the
// audio clock stands still for ~100 ms after the context starts while chunks
// keep arriving, and a network stall releases its backlog in one burst. Chunks
// therefore play slightly fast while the lead is above target, which drains it
// over a few seconds without a gap.

/** Lead the playhead keeps over the audio clock after a (re)start. */
const TARGET_LEAD_S = 0.05;
/** Lead above which chunks play at `CATCH_UP_RATE` to drain it. */
const CATCH_UP_LEAD_S = 0.07;
/**
 * 2% faster: a third of a semitone, barely audible over game music, and it
 * sheds 20 ms of lead per second.
 */
const CATCH_UP_RATE = 1.02;
/**
 * Lead past which incoming chunks are dropped outright. Catching up from here
 * would take too long; every sound until then would play this late.
 */
const MAX_LEAD_S = 0.25;

export type FeedAudioFormat = {
  readonly sampleRate: number;
  readonly channels: number;
};

export type FeedAudioSchedule = {
  /** Audio-clock time to start the chunk at. */
  readonly startS: number;
  readonly playbackRate: number;
};

/**
 * When and how fast to play the next chunk, or undefined to drop it.
 *
 * A playhead the clock has overtaken (an underrun: the network starved us)
 * restarts at the target lead, so the next chunk is not scheduled in the past
 * and clipped. A lead above target plays the chunk slightly fast; a lead far
 * above it drops the chunk rather than queueing behind stale sound.
 */
export function scheduleFeedAudioChunk(
  playheadS: number,
  nowS: number,
): FeedAudioSchedule | undefined {
  if (playheadS < nowS) {
    return { startS: nowS + TARGET_LEAD_S, playbackRate: 1 };
  }
  const leadS = playheadS - nowS;
  if (leadS > MAX_LEAD_S) return undefined;
  return {
    startS: playheadS,
    playbackRate: leadS > CATCH_UP_LEAD_S ? CATCH_UP_RATE : 1,
  };
}

/** De-interleave s16le PCM into one float channel per output channel. */
export function decodeFeedAudioPcm(
  pcm: DataView,
  channels: number,
): Float32Array<ArrayBuffer>[] {
  const frames = Math.floor(pcm.byteLength / (2 * channels));
  const planes = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = pcm.getInt16((frame * channels + channel) * 2, true);
      planes[channel][frame] = sample / 0x80_00;
    }
  }
  return planes;
}

/**
 * Plays the feed's audio until closed.
 *
 * Browsers start an AudioContext suspended until the page has had a user
 * gesture. `unlock()` is wired to the page's first click or key press; chunks
 * that arrive before then are dropped rather than played late.
 */
export class FeedAudioPlayer {
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private readonly gain: GainNode;
  private playheadS = 0;

  constructor(muted: boolean) {
    this.gain = this.context.createGain();
    this.gain.gain.value = muted ? 0 : 1;
    this.gain.connect(this.context.destination);
  }

  get running(): boolean {
    return this.context.state === "running";
  }

  unlock(): Promise<void> {
    return this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.gain.gain.value = muted ? 0 : 1;
  }

  play(pcm: DataView, format: FeedAudioFormat): void {
    if (!this.running) return;
    const schedule = scheduleFeedAudioChunk(
      this.playheadS,
      this.context.currentTime,
    );
    if (schedule === undefined) return;
    const planes = decodeFeedAudioPcm(pcm, format.channels);
    const frames = planes[0]?.length ?? 0;
    if (frames === 0) return;
    // An AudioBuffer at the game's own rate: the source node resamples to the
    // output device, so the page never resamples by hand.
    const buffer = this.context.createBuffer(
      format.channels,
      frames,
      format.sampleRate,
    );
    planes.forEach((plane, channel) => {
      buffer.copyToChannel(plane, channel);
    });
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = schedule.playbackRate;
    source.connect(this.gain);
    source.start(schedule.startS);
    this.playheadS = schedule.startS + buffer.duration / schedule.playbackRate;
  }

  close(): void {
    void this.context.close();
  }
}
