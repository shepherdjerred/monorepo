/**
 * The sound cues, as data: each is a few synthesized tones, so the app ships
 * no audio files. Times are seconds from the cue's start; every cue ends by
 * `maxCueSeconds` and no tone peaks above `maxGain`.
 */
export type Tone =
  | {
      kind: "tone";
      wave: OscillatorType;
      /** Hz at the start and end of the tone; it glides between them. */
      from: number;
      to: number;
      at: number;
      duration: number;
      gain: number;
    }
  | {
      kind: "noise";
      /** A band-pass filter sweeps across these Hz. */
      from: number;
      to: number;
      at: number;
      duration: number;
      gain: number;
    };

export const cueNames = [
  "create",
  "complete",
  "status",
  "drop",
  "comment",
  "undo",
  "error",
  "palette",
] as const;
export type CueName = (typeof cueNames)[number];

export const maxCueSeconds = 0.12;
export const maxGain = 0.08;

/** A tone gliding over `[from, to]` Hz during `[at, duration]` seconds. */
const tone = (
  wave: OscillatorType,
  [from, to]: readonly [number, number],
  [at, duration]: readonly [number, number],
  gain: number,
): Tone => ({ kind: "tone", wave, from, to, at, duration, gain });

export const cues: Record<CueName, readonly Tone[]> = {
  // A soft two-note rise: something new exists.
  create: [
    tone("sine", [659, 659], [0, 0.06], 0.05),
    tone("sine", [988, 988], [0.05, 0.065], 0.045),
  ],
  // A bright tick with a little shimmer above it.
  complete: [
    tone("triangle", [1760, 1320], [0, 0.06], 0.06),
    tone("sine", [2637, 2637], [0, 0.035], 0.02),
  ],
  // Barely there: a status moved.
  status: [tone("sine", [1180, 820], [0, 0.028], 0.03)],
  // A low thunk as a card lands.
  drop: [tone("sine", [190, 85], [0, 0.09], 0.08)],
  // A short breath of filtered noise: sent.
  comment: [
    {
      kind: "noise",
      from: 700,
      to: 3200,
      at: 0,
      duration: 0.11,
      gain: 0.05,
    },
  ],
  // The create rise played backwards.
  undo: [
    tone("sine", [988, 988], [0, 0.055], 0.04),
    tone("sine", [659, 659], [0.045, 0.065], 0.04),
  ],
  // Two low buzzes, filtered so they never rasp.
  error: [
    tone("square", [146, 140], [0, 0.045], 0.035),
    tone("square", [146, 140], [0.065, 0.045], 0.035),
  ],
  // An airy upward blip.
  palette: [tone("sine", [1320, 1860], [0, 0.05], 0.025)],
};

/** How long a cue sounds, in seconds. */
export function cueLength(name: CueName) {
  return Math.max(...cues[name].map(({ at, duration }) => at + duration));
}

/**
 * What a cue looks like from outside the audio graph: each tone's waveform
 * and starting pitch, or "noise". Tests recognise cues by it.
 */
export function cueSignature(name: CueName) {
  return cues[name].map((part) =>
    part.kind === "noise" ? "noise" : `${part.wave}:${String(part.from)}`,
  );
}
