/**
 * Pure builders for the output audio stage of `prepareStream`.
 *
 * Every step here is opt-in through {@link AudioProcessing}. With none requested the result is the
 * exact `-ac 2 -lfe_mix_level 1` + `volume@internal_lib=<gain>` pair this package has always
 * emitted, so a caller that sets nothing gets a byte-identical command line.
 */

/** Surround layouts (ffprobe `channel_layout` spellings) that have a dialogue downmix matrix. */
export const DIALOG_DOWNMIX_LAYOUTS = ["5.1", "5.1(side)", "7.1"] as const;
export type DialogDownmixLayout = (typeof DIALOG_DOWNMIX_LAYOUTS)[number];

export function isDialogDownmixLayout(
  layout: string | undefined,
): layout is DialogDownmixLayout {
  return DIALOG_DOWNMIX_LAYOUTS.some((candidate) => candidate === layout);
}

export type AudioProcessing = {
  /**
   * Replace swresample's generic `-ac 2 -lfe_mix_level 1` with a dialogue-first stereo matrix for
   * this source layout, followed by a peak limiter. Centre (dialogue) at unity, fronts -3 dB,
   * surrounds -6 dB, LFE dropped as the ITU/Dolby Lo/Ro downmix does.
   */
  readonly dialogDownmix?: DialogDownmixLayout;
  /** Realtime loudness normalisation ahead of the user's volume. */
  readonly loudnessNormalization?: boolean;
  /**
   * Stretch/squeeze audio onto its input timestamps (`aresample=async=1:first_pts=0`): fill holes
   * with silence and trim overlaps, so a sample-counting timestamp normaliser downstream cannot
   * drift away from the constant-frame-rate video clock.
   */
  readonly resyncTimestamps?: boolean;
};

/**
 * `pan` treats a channel name the input layout does not have as silence — it does not fail — so
 * each layout names its own surround pair: `5.1` carries them as BL/BR, `5.1(side)` as SL/SR, and
 * `7.1` has both.
 */
const SURROUND_TERMS: Record<DialogDownmixLayout, readonly [string, string]> = {
  "5.1": ["0.5*BL", "0.5*BR"],
  "5.1(side)": ["0.5*SL", "0.5*SR"],
  "7.1": ["0.5*SL+0.5*BL", "0.5*SR+0.5*BR"],
};

export function dialogDownmixFilter(layout: DialogDownmixLayout): string {
  const [left, right] = SURROUND_TERMS[layout];
  return `pan=stereo|FL=FC+0.707*FL+${left}|FR=FC+0.707*FR+${right}`;
}

/** -1 dBFS ceiling: room for libopus's inter-sample overshoot. `level=disabled` stops makeup gain. */
export const DOWNMIX_LIMITER = "alimiter=limit=0.891:level=disabled";

/**
 * Realtime loudness normaliser: 100 ms frames smoothed over a 9-frame Gaussian window, peaks aimed
 * at -6 dBFS (`p=0.5`), at most +14 dB of gain (`m=5`), and `b=1` so the first frames of every
 * segment (and every seek) take their neighbours' gain instead of swelling in from unity.
 *
 * Measured with ffmpeg 7.1.5 against a -26 and a -6 LUFS copy of the same music-like signal:
 * both leave at -16.7/-15.8 LUFS, the bed under 24 dB-crest hits moves 1.1 dB (p05-p95; the
 * filter's defaults move it 1.4 dB with a 15.8 s lookahead), ~0.5 s of added latency, and 97x
 * realtime CPU with libopus. Rejected: single-pass `loudnorm` (2.7 s lookahead, 192 kHz internal
 * rate, 4-5x the CPU) and `acompressor` (no latency, but 5-9 dB of pumping and it never lifts a
 * quiet source).
 */
export const LOUDNESS_NORMALIZER = "dynaudnorm=f=100:g=9:p=0.5:m=5:b=1";

export const AUDIO_RESYNC = "aresample=async=1:first_pts=0";

/**
 * Render a linear gain for ffmpeg's `volume` filter.
 *
 * Unity renders as the literal `1.0` this filter has always carried, so a caller that leaves
 * `audioVolume` alone gets a byte-identical command line to the one before the option existed —
 * the rawvideo bots (`discord-plays-pokemon`, `discord-plays-mario-kart`) pin that vector. Every
 * other value renders as itself, and `0` stays `0`: silence is a volume, not a missing option, so
 * it must never be rounded or promoted back to unity. ffmpeg parses `1` and `1.0` identically; the
 * spelling is preserved for the diff, not for the filter.
 */
export function formatAudioGain(gain: number): string {
  return gain === 1 ? "1.0" : String(gain);
}

export type AudioOutputStage = {
  /** Output options between `-map` and `-ar`: the legacy channel downmix, or nothing. */
  readonly channelOptions: readonly string[];
  /** The `-filter:a` chain. `volume@internal_lib` is always last; live volume control targets it. */
  readonly filters: readonly string[];
};

export function buildAudioOutputStage(
  gain: number,
  processing: AudioProcessing = {},
): AudioOutputStage {
  const downmix = processing.dialogDownmix;
  return {
    channelOptions:
      downmix === undefined ? ["-ac", "2", "-lfe_mix_level", "1"] : [],
    filters: [
      ...(processing.resyncTimestamps === true ? [AUDIO_RESYNC] : []),
      ...(downmix === undefined ? [] : [dialogDownmixFilter(downmix)]),
      ...(processing.loudnessNormalization === true
        ? [LOUDNESS_NORMALIZER]
        : []),
      ...(downmix === undefined ? [] : [DOWNMIX_LIMITER]),
      `volume@internal_lib=${formatAudioGain(gain)}`,
    ],
  };
}
