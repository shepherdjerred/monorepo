/** Offline first-party synthesis. Integer phase, envelope and seeded noise only. */
export const sampleRate = 48_000;
export const cueNames = ["create", "complete", "delete", "reverse"] as const;
export type CueName = (typeof cueNames)[number];
type Pulse = {
  start: number;
  length: number;
  hz: number;
  endHz: number;
  weight: number;
};

const voices: Record<
  CueName,
  { milliseconds: number; peak: number; pulses: Pulse[] }
> = {
  create: {
    milliseconds: 104,
    peak: 7200,
    pulses: [{ start: 0, length: 104, hz: 820, endHz: 680, weight: 100 }],
  },
  complete: {
    milliseconds: 176,
    peak: 9000,
    pulses: [
      { start: 0, length: 84, hz: 620, endHz: 580, weight: 100 },
      { start: 62, length: 114, hz: 930, endHz: 860, weight: 72 },
    ],
  },
  delete: {
    milliseconds: 120,
    peak: 6200,
    pulses: [{ start: 0, length: 120, hz: 340, endHz: 260, weight: 100 }],
  },
  reverse: {
    milliseconds: 88,
    peak: 5600,
    pulses: [{ start: 0, length: 88, hz: 1100, endHz: 740, weight: 100 }],
  },
};

function oscillator(phase: number): number {
  const triangle = phase < 32_768 ? phase * 2 - 32_768 : 98_304 - phase * 2;
  return Math.trunc((triangle * (65_536 - Math.abs(triangle))) / 32_768);
}

function addPulse(samples: number[], pulse: Pulse): void {
  const start = pulse.start * 48;
  const length = pulse.length * 48;
  const attack = 144;
  let phase = 0;
  let filtered = 0;
  let noise = 0x51f15e;
  for (let index = 0; index < length; index++) {
    const hz =
      pulse.hz + Math.trunc(((pulse.endHz - pulse.hz) * index) / length);
    phase = (phase + Math.round((hz * 65_536) / sampleRate)) % 65_536;
    noise = (Math.imul(noise, 1_664_525) + 1_013_904_223) >>> 0;
    const raw =
      oscillator(phase) +
      Math.trunc(oscillator((phase * 2) % 65_536) / 8) +
      ((noise >>> 20) - 2048);
    filtered = Math.trunc((filtered * 3 + raw) / 4);
    const remaining = length - 1 - index;
    const envelope = Math.trunc(
      (remaining * remaining * 32_768) / (length * length),
    );
    const fadeIn = Math.min(index, attack);
    const value = Math.trunc(
      (filtered * envelope * fadeIn * pulse.weight) / (32_768 * attack * 100),
    );
    const position = start + index;
    samples[position] = (samples[position] ?? 0) + value;
  }
}

export function synthesizeCue(name: CueName): Uint8Array {
  const voice = voices[name];
  const samples = Array.from({ length: voice.milliseconds * 48 }, () => 0);
  for (const pulse of voice.pulses) addPulse(samples, pulse);
  const maximum = samples.reduce(
    (peak, sample) => Math.max(peak, Math.abs(sample)),
    0,
  );
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    bytes.set(new TextEncoder().encode(value), offset);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) =>
    view.setInt16(
      44 + index * 2,
      Math.trunc((sample * voice.peak) / maximum),
      true,
    ),
  );
  return bytes;
}
