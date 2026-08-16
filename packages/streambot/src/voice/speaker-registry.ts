import type { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import type {
  KeywordDetector,
  LocalVoiceModels,
} from "@shepherdjerred/streambot/voice/local-models.ts";

/**
 * Upper bound on concurrently retained per-speaker decoder/detector state. Discord voice
 * channels cap at 99 members but sessions run for hours and CLIENT_DISCONNECT is not
 * guaranteed for every departure, so without a bound the map grows with every distinct
 * speaker ever heard. Eviction is least-recently-heard; an evicted speaker who talks again
 * just rebuilds lazily.
 */
const MAX_SPEAKERS = 8;

export type SpeakerState = {
  readonly decoder: Pick<DiscordOpusDecoder, "decode" | "close">;
  readonly keyword: KeywordDetector;
  /** Last time this speaker's audio arrived, for least-recently-heard eviction. */
  lastHeardAtMs: number;
  rolling: Float32Array[];
  rollingSamples: number;
  /**
   * Samples fed to the keyword detector since its stream was last reset. sherpa's timestamps are
   * stream-relative, so this is what converts them into a position in the audio we are holding.
   */
  keywordStreamSamples: number;
};

function clearRolling(speaker: SpeakerState): void {
  for (const part of speaker.rolling) part.fill(0);
  speaker.rolling.length = 0;
  speaker.rollingSamples = 0;
}

/** Bounded per-speaker decoder/detector/pre-roll state, owned by the audio lifecycle. */
export class SpeakerRegistry {
  private readonly speakers = new Map<string, SpeakerState>();

  constructor(
    private readonly models: LocalVoiceModels,
    private readonly createDecoder: () => Pick<
      DiscordOpusDecoder,
      "decode" | "close"
    >,
    private readonly now: () => number,
  ) {}

  acquire(userId: string): SpeakerState {
    const nowMs = this.now();
    const existing = this.speakers.get(userId);
    if (existing !== undefined) {
      existing.lastHeardAtMs = nowMs;
      return existing;
    }
    if (this.speakers.size >= MAX_SPEAKERS) {
      let oldest: [string, SpeakerState] | null = null;
      for (const entry of this.speakers) {
        if (oldest === null || entry[1].lastHeardAtMs < oldest[1].lastHeardAtMs)
          oldest = entry;
      }
      if (oldest !== null) {
        this.clearSpeaker(oldest[1]);
        this.speakers.delete(oldest[0]);
      }
    }
    const created: SpeakerState = {
      decoder: this.createDecoder(),
      keyword: this.models.createKeywordDetector(),
      lastHeardAtMs: nowMs,
      rolling: [],
      rollingSamples: 0,
      keywordStreamSamples: 0,
    };
    this.speakers.set(userId, created);
    return created;
  }

  pushRolling(
    speaker: SpeakerState,
    samples: Float32Array,
    maximumSamples: number,
  ): void {
    speaker.rolling.push(samples);
    speaker.rollingSamples += samples.length;
    while (
      speaker.rollingSamples > maximumSamples &&
      speaker.rolling.length > 1
    ) {
      const removed = speaker.rolling.shift();
      if (removed !== undefined) {
        speaker.rollingSamples -= removed.length;
        removed.fill(0);
      }
    }
  }

  destroy(userId: string): void {
    const speaker = this.speakers.get(userId);
    if (speaker === undefined) return;
    this.clearSpeaker(speaker);
    this.speakers.delete(userId);
  }

  /** Destroy every speaker except the one that triggered a wake candidate. */
  retainOnly(userId: string): void {
    for (const [otherUserId, state] of this.speakers) {
      if (otherUserId !== userId) {
        this.clearSpeaker(state);
        this.speakers.delete(otherUserId);
      }
    }
  }

  clearAll(): void {
    for (const speaker of this.speakers.values()) this.clearSpeaker(speaker);
    this.speakers.clear();
  }

  private clearSpeaker(speaker: SpeakerState): void {
    speaker.decoder.close();
    speaker.keyword.close();
    clearRolling(speaker);
  }
}
