// Synthetic Web Audio transport control. No League media or replay data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium } = require("@playwright/test");
const sampleRate = 24_000;
const samples = sampleRate;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const frequency = i < samples / 2 ? 375 : 600;
  wav.writeInt16LE(
    Math.round(12_000 * Math.sin((2 * Math.PI * frequency * i) / sampleRate)),
    44 + i * 2,
  );
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/")
      return new Response("<button>Enable</button>", {
        headers: { "Content-Type": "text/html" },
      });
    if (path === "/replay-audio.mjs" || path === "/playback.mjs")
      return new Response(Bun.file(new URL(`..${path}`, import.meta.url)), {
        headers: { "Content-Type": "text/javascript" },
      });
    if (path === "/assets/audio/package.json")
      return Response.json({
        build: "synthetic-audio-control",
        clips: { tone: { file: "tone.wav", event: "Synthetic tone" } },
        bindings: { "fixture:attack": "tone" },
      });
    if (path === "/assets/audio/tone.wav")
      return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
    return new Response(null, { status: 404 });
  },
});

let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.goto(server.url.href);
  await page.evaluate(async () => {
    const { ReplayAudio } = await import("/replay-audio.mjs");
    const { PLAYER_START } = await import("/playback.mjs");
    const audio = new ReplayAudio(
      {
        build: "synthetic-audio-control",
        roster: [{ champion: "Fixture" }],
        gameplay: [0, 2].map((time) => ({
          kind: "attack",
          time,
          entityId: PLAYER_START,
        })),
      },
      { state: () => ({ point: [0, 0] }) },
    );
    await audio.load();
    window.audio = audio;
    window.createAudio = () => new ReplayAudio(audio.replay, audio.combat);
    document.querySelector("button").onclick = async () => {
      await audio.enable();
      const analyser = audio.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      audio.gain.connect(analyser);
      window.measure = () => {
        const wave = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(wave);
        const spectrum = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(spectrum);
        let peak = 0;
        for (let i = 1; i < spectrum.length; i++)
          if (spectrum[i] > spectrum[peak]) peak = i;
        return {
          rms: Math.sqrt(
            wave.reduce((sum, sample) => sum + sample * sample, 0) /
              wave.length,
          ),
          frequency: (peak * audio.context.sampleRate) / analyser.fftSize,
        };
      };
      audio.reset(0);
      audio.update(0.05, true, 1, [0, 0]);
    };
  });
  await page.getByRole("button", { name: "Enable" }).click();
  await page.waitForFunction(() => window.measure?.().rms > 0.05);
  const initial = await page.evaluate(() => window.measure());
  assert.ok(Math.abs(initial.frequency - 375) < 30, JSON.stringify(initial));
  await page.evaluate(() => window.audio.update(0.3, true, 1, [0, 0], 1));
  await page.waitForFunction(() => window.measure().rms < 0.001);
  await page.evaluate(() => {
    window.audio.reset(0);
    window.audio.update(0.05, true, 1, [0, 0]);
  });
  await page.waitForFunction(() => window.measure().rms > 0.05);
  await page.evaluate(() => window.audio.update(0.1, false, 1, [0, 0]));
  await page.waitForFunction(() => window.measure().rms < 0.001);

  await page.evaluate(() => {
    window.audio.reset(2);
    window.audio.update(2.1, true, 1, [0, 0]);
  });
  await page.waitForFunction(() => window.measure().rms > 0.05);
  await page.evaluate(() => window.audio.update(2.2, true, 2, [0, 0]));
  await page.waitForFunction(
    () =>
      Math.abs(window.measure().frequency - 750) < 30 &&
      window.measure().rms > 0.05,
  );
  const fast = await page.evaluate(() => window.measure());
  await page.evaluate(() => window.audio.update(1, true, 2, [0, 0]));
  await page.waitForFunction(() => window.measure().rms < 0.001);
  await page.evaluate(() => {
    window.audio.update(1.9, true, 1, [0, 0]);
    window.audio.update(2.6, true, 1, [0, 0]);
  });
  await page.waitForFunction(() => window.measure().rms > 0.05);
  const offset = await page.evaluate(() => window.measure());
  assert.ok(Math.abs(offset.frequency - 600) < 30, JSON.stringify(offset));
  const disposed = await page.evaluate(async () => {
    const context = window.audio.context;
    await window.audio.dispose();
    window.audio.update(2.5, true, 1, [0, 0]);
    await window.audio.enable();
    const { sources, enabled, scheduled, buffers, gain } = window.audio;
    return {
      voices: sources.size,
      enabled,
      scheduled,
      contextState: context.state,
      releasedResources: !buffers && !gain && !window.audio.context,
    };
  });
  assert.deepEqual(disposed, {
    voices: 0,
    enabled: false,
    scheduled: 4,
    contextState: "closed",
    releasedResources: true,
  });
  let releaseFetch;
  const waitForDisposal = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  await page.route("**/assets/audio/tone.wav", async (route) => {
    await waitForDisposal;
    await route.continue();
  });
  await page.evaluate(async () => {
    const pendingAudio = window.createAudio();
    await pendingAudio.load();
    window.pendingAudio = pendingAudio;
    document.querySelector("button").onclick = () => {
      window.enabling = pendingAudio.enable();
    };
  });
  try {
    await Promise.all([
      page.waitForRequest("**/assets/audio/tone.wav"),
      page.getByRole("button", { name: "Enable" }).click(),
    ]);
    await page.evaluate(async () => {
      const { context, clipLoad } = window.pendingAudio;
      await window.pendingAudio.dispose();
      window.pendingClosedContext = context;
      window.pendingClipSignal = clipLoad.signal;
    });
  } finally {
    releaseFetch();
  }
  const pendingDisposal = await page.evaluate(async () => {
    await window.enabling;
    return {
      enabled: window.pendingAudio.enabled,
      scheduled: window.pendingAudio.scheduled,
      contextState: window.pendingClosedContext.state,
      abortedClipFetch: window.pendingClipSignal.aborted,
      releasedResources:
        !window.pendingAudio.bufferLoad && !window.pendingAudio.context,
    };
  });
  assert.deepEqual(pendingDisposal, {
    enabled: false,
    scheduled: 0,
    contextState: "closed",
    abortedClipFetch: true,
    releasedResources: true,
  });
  console.log(
    JSON.stringify(
      {
        scope: "synthetic Web Audio control",
        initial,
        fast,
        offset,
        pauseSilent: true,
        wallStallSilent: true,
        backwardSeekSilent: true,
        disposed,
        pendingDisposal,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.stop(true);
}
