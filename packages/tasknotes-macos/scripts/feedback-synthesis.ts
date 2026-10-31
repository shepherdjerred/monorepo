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

function monoPcm16Wave(pcm: Uint8Array): Uint8Array {
  const format = new Uint8Array(16);
  const fields = new DataView(format.buffer);
  fields.setUint16(0, 1, true); // PCM
  fields.setUint16(2, 1, true); // mono
  fields.setUint32(4, sampleRate, true);
  fields.setUint32(8, sampleRate * 2, true);
  fields.setUint16(12, 2, true); // bytes per frame
  fields.setUint16(14, 16, true); // bits per sample
  // Both owned payloads have even lengths, so neither RIFF chunk needs padding.
  const chunks = [
    { id: "fmt ", payload: format },
    { id: "data", payload: pcm },
  ];
  const bytes = new Uint8Array(
    12 + chunks.reduce((length, chunk) => length + 8 + chunk.payload.length, 0),
  );
  const view = new DataView(bytes.buffer);
  const text = new TextEncoder();
  bytes.set(text.encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(text.encode("WAVE"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(text.encode(chunk.id), offset);
    view.setUint32(offset + 4, chunk.payload.length, true);
    bytes.set(chunk.payload, offset + 8);
    offset += 8 + chunk.payload.length;
  }
  return bytes;
}

export function synthesizeCue(name: CueName): Uint8Array {
  const voice = voices[name];
  const samples = Array.from({ length: voice.milliseconds * 48 }, () => 0);
  for (const pulse of voice.pulses) addPulse(samples, pulse);
  const maximum = samples.reduce(
    (peak, sample) => Math.max(peak, Math.abs(sample)),
    0,
  );
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  samples.forEach((sample, index) =>
    view.setInt16(index * 2, Math.trunc((sample * voice.peak) / maximum), true),
  );
  return monoPcm16Wave(pcm);
}
