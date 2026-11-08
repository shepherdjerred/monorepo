import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  out = ".cache/replay-lineup-5667809143/research/browser-cdp-v37-1080p";
const control = async (particles, speed, time) =>
  c.evaluate(
    `(()=>{const p=document.querySelector('#play'),e=document.querySelector('#particles'),s=document.querySelector('#speed'),t=document.querySelector('#seek');if(p.textContent.trim()==='Pause')p.click();if(e.checked!==${particles})e.click();s.value='${speed}';s.dispatchEvent(new Event('change'));t.value='${time}';t.dispatchEvent(new Event('input'));return {time:t.value,particles:e.checked,speed:s.value}})()`,
  );
const meta = {
  started: new Date().toISOString(),
  browser: (await c.send("Browser.getVersion")).product,
  url: "http://127.0.0.1:4181/latest.html",
  scope:
    "actual isolated headless Chrome, hardware ANGLE D3D11; not user normal-profile acceptance",
  runs: [],
};
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  meta.display = await c.evaluate(
    "(()=>{const x=document.querySelector('canvas');return {width:x.width,height:x.height,dpr:devicePixelRatio}})()",
  );
  if (
    meta.display.width !== 1920 ||
    meta.display.height !== 1080 ||
    meta.display.dpr !== 1
  )
    throw Error("Exact display required");
  await control(false, 1, 68.5);
  await new Promise((r) => setTimeout(r, 1500));
  meta.contract = await c.evaluate(
    "replayEffectDiagnostics.startPerformanceRecording()",
  );
  for (const [name, particles, speed] of [
    ["worldOnly", false, 1],
    ["effects1x", true, 1],
    ["effects4x", true, 4],
  ]) {
    await control(particles, speed, 68.5);
    await new Promise((r) => setTimeout(r, 1200));
    const start = Date.now();
    await c.evaluate(`document.querySelector('#play').click()`);
    let state;
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      state = await c.evaluate(
        `({time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent,status:document.querySelector('#status').textContent,play:document.querySelector('#play').textContent})`,
      );
      if (state.error) throw Error(JSON.stringify(state));
      if (state.time >= 100) break;
      if (Date.now() - start > 90000)
        throw Error("Playback timeout " + JSON.stringify(state));
    }
    await c.evaluate(`document.querySelector('#play').click()`);
    meta.runs.push({
      name,
      particles,
      speed,
      wallMs: Date.now() - start,
      end: state,
    });
    console.log(JSON.stringify(meta.runs.at(-1)));
  }
  const recording = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  await Bun.write(out + "-recording.json", JSON.stringify(recording));
  meta.recordedFrames = recording.frames.length;
} catch (error) {
  meta.failure = String(error);
  try {
    const recording = await c.evaluate(
      "replayEffectDiagnostics.stopPerformanceRecording()",
    );
    await Bun.write(out + "-recording.json", JSON.stringify(recording));
    meta.recordedFrames = recording.frames.length;
  } catch {}
}
meta.events = c.events;
meta.finished = new Date().toISOString();
await Bun.write(out + "-controls.json", JSON.stringify(meta, null, 2));
console.log(
  JSON.stringify(
    {
      failure: meta.failure,
      frames: meta.recordedFrames,
      eventCount: c.events.length,
      events: c.events.slice(-5),
    },
    null,
    2,
  ),
);
c.close();
