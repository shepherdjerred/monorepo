import { cues, type CueName, type Tone } from "./cues.ts";

/**
 * One shared AudioContext, created the first time it is needed after a user
 * gesture, so the browser lets it start. Browsers without Web Audio stay
 * silent.
 */
let context: AudioContext | undefined;
let noise: AudioBuffer | undefined;

function audio() {
  if (typeof AudioContext === "undefined") {
    return;
  }
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") {
    void context.resume();
  }
  return context;
}

/** Start or resume the context inside a gesture, before the first cue. */
export function prepareAudio() {
  audio();
}

function noiseBuffer(ctx: AudioContext) {
  if (noise === undefined) {
    noise = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * 0.2),
      ctx.sampleRate,
    );
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
  }
  return noise;
}

/** A fast attack and an exponential release keep every tone click-free. */
function envelope(ctx: AudioContext, part: Tone, start: number) {
  const gain = ctx.createGain();
  const end = start + part.duration;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(part.gain, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(ctx.destination);
  return { gain, end };
}

function playTone(ctx: AudioContext, part: Tone, start: number) {
  const { gain, end } = envelope(ctx, part, start);
  if (part.kind === "noise") {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(part.from, start);
    band.frequency.exponentialRampToValueAtTime(part.to, end);
    source.connect(band).connect(gain);
    source.start(start);
    source.stop(end);
    return;
  }
  const oscillator = ctx.createOscillator();
  oscillator.type = part.wave;
  oscillator.frequency.setValueAtTime(part.from, start);
  if (part.to !== part.from) {
    oscillator.frequency.exponentialRampToValueAtTime(part.to, end);
  }
  if (part.wave === "square") {
    // Square waves rasp; a low-pass keeps only their body.
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 900;
    oscillator.connect(soft).connect(gain);
  } else {
    oscillator.connect(gain);
  }
  oscillator.start(start);
  oscillator.stop(end);
}

export function playCue(name: CueName) {
  const ctx = audio();
  if (ctx === undefined) {
    return;
  }
  // A few milliseconds ahead, so the first tone is never clipped.
  const start = ctx.currentTime + 0.005;
  for (const part of cues[name]) {
    playTone(ctx, part, start + part.at);
  }
}
