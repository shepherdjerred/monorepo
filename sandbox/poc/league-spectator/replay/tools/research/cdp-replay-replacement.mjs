import { connectReplayBrowser } from "./cdp-client.mjs";

const [origin, stem] = process.argv.slice(2);
if (!origin || !stem || process.argv.length !== 4)
  throw Error("Usage: bun cdp-replay-replacement.mjs <origin> <output-stem>");
if (await Bun.file(stem + ".json").exists())
  throw Error("Preserve earlier replacement evidence");
const c = await connectReplayBrowser();
const runId = crypto.randomUUID();
const report = {
  scope:
    "Browser regression: real decoder with diagnostic endTime override; not FPS evidence",
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = () =>
  c.evaluate(
    `({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,disabled:document.querySelector('#play')?.disabled,loadDisabled:document.querySelector('#load')?.disabled,seekDisabled:document.querySelector('#seek')?.disabled,time:Number(document.querySelector('#seek')?.value),endTime:Number(document.querySelector('#seek')?.max)})`,
  );
async function until(predicate) {
  const start = Date.now();
  for (;;) {
    const value = await state();
    if (value.error) throw Error(value.error);
    if (predicate(value)) return value;
    if (Date.now() - start > 180000)
      throw Error("Browser condition timed out: " + JSON.stringify(value));
    await pause(100);
  }
}
async function seek(time) {
  await c.evaluate(
    `{const s=document.querySelector('#seek');s.value=${JSON.stringify(String(time))};s.dispatchEvent(new Event('input'));}`,
  );
  await until((s) => s.time === time);
}
let held = null,
  injection = null,
  release = false;
const unsubscribe = c.onEvent((event) => {
  if (event.method !== "Fetch.requestPaused") return;
  if (!held) held = event.params;
  else
    c.send("Fetch.continueRequest", {
      requestId: event.params.requestId,
    }).catch(() => {});
});
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  // Preserve the original worker and its real decoding. Only select the existing
  // reconstruction endTime input, which the ordinary viewer does not expose.
  injection = await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `{
    const NativeWorker=window.Worker;
    window.__replacementRun=${JSON.stringify(runId)};
    window.__replacementEndTime=120;
    window.Worker=class extends NativeWorker {
      constructor(url,options){super(url,options);this.replacementDecoder=String(url).includes('structural-check-worker.mjs');}
      postMessage(data,...rest){return super.postMessage(this.replacementDecoder&&data?.type==='reconstruct'?{...data,endTime:window.__replacementEndTime}:data,...rest);}
    };
  }`,
  });
  await c.send("Page.navigate", { url: origin + "/latest.html" });
  while ((await c.evaluate("window.__replacementRun")) !== runId)
    await pause(50);
  await until((s) => s.loadDisabled === false);
  await c.evaluate("document.querySelector('#load').click()");
  report.first = await until(
    (s) => s.status?.startsWith("Ready") && !s.disabled,
  );
  await seek(110);
  report.beforeReplacement = await state();
  await c.send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*/model.glb*",
        requestStage: "Request",
      },
    ],
  });
  await c.evaluate(
    "window.__replacementEndTime=60;document.querySelector('#load').click()",
  );
  await until(() => held !== null);
  report.held = await state();
  if (!report.held.disabled || !report.held.seekDisabled)
    throw Error("Replacement admitted before resource load");
  await c.evaluate("document.querySelector('#roster button')?.click()");
  // Wait on actual rendered frames while initialization is deliberately held.
  await c.evaluate(
    "new Promise(resolve=>{let frames=0;function next(){if(++frames===30)resolve();else requestAnimationFrame(next)}requestAnimationFrame(next)})",
  );
  report.afterFrames = await state();
  await c.send("Fetch.continueRequest", { requestId: held.requestId });
  release = true;
  await c.send("Fetch.disable");
  report.replacement = await until(
    (s) => s.status?.startsWith("Ready") && !s.disabled,
  );
  if (report.replacement.endTime !== 60 || report.replacement.time > 60)
    throw Error("Short replacement clock not bounded");
  const captures = [];
  for (const previousTime of [46, 58]) {
    await seek(previousTime);
    // A seek only resets the clock. Render the starting world before clicking
    // so stale group transforms would differ between the two jump attempts.
    const previous = await c.evaluate(`(async()=>{
      const captured=await replayEffectDiagnostics.captureCurrent();
      return {time:captured.time,cameraWorld:captured.drawSnapshot.cameraWorld};
    })()`);
    await c.evaluate("document.querySelector('#minion-jump').click()");
    const capture = await c.evaluate(
      "replayEffectDiagnostics.captureCurrent()",
    );
    if (captures.length === 0)
      await Bun.write(
        stem + "-minion.png",
        Buffer.from(capture.image.split(",")[1], "base64"),
      );
    captures.push({
      previousTime,
      previous,
      time: capture.time,
      cameraWorld: capture.drawSnapshot.cameraWorld,
      cameraProjection: capture.drawSnapshot.cameraProjection,
    });
  }
  report.minionJumps = captures;
  if (
    captures[0].time !== captures[1].time ||
    captures[0].cameraWorld.some(
      (v, i) => Math.abs(v - captures[1].cameraWorld[i]) > 1e-7,
    )
  )
    throw Error("Minion jump depends on previous world transform");
  const errors = c.events.filter(
    (e) =>
      e.method === "Runtime.exceptionThrown" ||
      e.method === "Runtime.consoleAPICalled" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error"),
  );
  if (errors.length)
    throw Error("Browser runtime errors: " + JSON.stringify(errors));
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = String(error);
} finally {
  if (held && !release)
    await c
      .send("Fetch.continueRequest", { requestId: held.requestId })
      .catch(() => {});
  await c.send("Fetch.disable").catch(() => {});
  if (injection)
    await c.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: injection.identifier,
    });
  unsubscribe();
  report.events = c.events;
  await Bun.write(stem + ".json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      pass: report.pass,
      failure: report.failure,
      first: report.first?.endTime,
      replacement: report.replacement,
      events: c.events.length,
      minionJumps: report.minionJumps,
    }),
  );
  c.close();
}
if (!report.pass) process.exitCode = 1;
