import { connectReplayBrowser } from "./cdp-client.mjs";
const origin = process.argv[2] ?? "http://127.0.0.1:4181",
  stem =
    process.argv[3] ??
    ".cache/replay-lineup-5667809143/research/browser-cdp-v37-final";
const c = await connectReplayBrowser(),
  meta = {
    started: new Date().toISOString(),
    origin,
    browser: (await c.send("Browser.getVersion")).product,
    events: [],
    scripts: [],
  };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () =>
  c.evaluate(
    `({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,loadDisabled:document.querySelector('#load')?.disabled,time:Number(document.querySelector('#seek')?.value),play:document.querySelector('#play')?.textContent,canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height,devicePixelRatio]})`,
  );
async function ready(predicate) {
  const start = Date.now();
  for (;;) {
    const s = await state();
    if (s.error) throw Error(JSON.stringify(s));
    if (predicate(s)) return s;
    if (Date.now() - start > 150000)
      throw Error("Ready timeout " + JSON.stringify(s));
    await sleep(500);
  }
}
async function controls(effects, speed, time) {
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play'),e=document.querySelector('#particles'),s=document.querySelector('#speed'),t=document.querySelector('#seek');if(p.textContent.trim()==='Pause')p.click();if(e.checked!==${effects})e.click();s.value='${speed}';s.dispatchEvent(new Event('change'));t.value='${time}';t.dispatchEvent(new Event('input'));})()`,
  );
}
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  const nav = await c.send("Page.navigate", { url: origin + "/latest.html" });
  for (let n = 0; ; n++) {
    const tree = await c.send("Page.getFrameTree");
    if (tree.frameTree.frame.loaderId === nav.loaderId) break;
    if (n > 60) throw Error("Navigation commit timeout");
    await sleep(100);
  }
  meta.mapReady = await ready((s) => s.loadDisabled === false);
  await c.evaluate(`document.querySelector('#load').click()`);
  meta.decoded = await ready((s) => s.status?.startsWith("Ready ·"));
  if (JSON.stringify(meta.decoded.canvas) !== "[1920,1080,1]")
    throw Error("Reference canvas mismatch");
  for (const s of c.scriptResponses) {
    if (s.status !== 200) throw Error("Script status " + JSON.stringify(s));
    try {
      const r = await c.send("Network.getResponseBody", {
          requestId: s.requestId,
        }),
        b = r.base64Encoded
          ? Buffer.from(r.body, "base64")
          : Buffer.from(r.body),
        hash = new Bun.CryptoHasher("sha256").update(b).digest("hex");
      const path = ".cache/replay-spike/research/browser-source-blobs/" + hash;
      await Bun.write(path, b);
      meta.scripts.push({ url: s.url, sha256: hash, bytes: b.length, path });
    } catch (e) {
      meta.scripts.push({ url: s.url, bodyUnavailable: String(e) });
    }
  }
  console.log(
    JSON.stringify({
      stage: "ready",
      state: meta.decoded,
      scripts: meta.scripts.length,
    }),
  );
  if (process.argv[4]) {
    while (!(await Bun.file(process.argv[4]).exists())) await sleep(500);
  }
  await controls(false, 1, 68.5);
  await sleep(1000);
  meta.contract = await c.evaluate(
    "replayEffectDiagnostics.startPerformanceRecording()",
  );
  meta.runs = [];
  for (const [name, effects, speed] of [
    ["worldOnly", false, 1],
    ["effects1x", true, 1],
    ["effects4x", true, 4],
  ]) {
    await controls(effects, speed, 68.5);
    await sleep(1200);
    const start = Date.now();
    await c.evaluate(`document.querySelector('#play').click()`);
    let s;
    for (;;) {
      await sleep(500);
      s = await state();
      if (s.error) throw Error(JSON.stringify(s));
      if (s.time >= 100) break;
      if (Date.now() - start > 90000) throw Error("Playback timeout");
    }
    await c.evaluate(`document.querySelector('#play').click()`);
    meta.runs.push({
      name,
      effects,
      speed,
      wallMs: Date.now() - start,
      end: s,
    });
    console.log(JSON.stringify(meta.runs.at(-1)));
  }
  const r = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  await Bun.write(stem + "-recording.json", JSON.stringify(r));
  meta.recordedFrames = r.frames.length;
  await controls(true, 1, 82.35);
  await sleep(1500);
  const captures = [];
  for (const t of [82.35, 74, 82.35, 50.2, 79.83333333333333, 50.2]) {
    await controls(true, 1, t);
    await sleep(1500);
    const a = await c.evaluate("replayEffectDiagnostics.captureCurrent()"),
      b = Buffer.from(a.image.split(",")[1], "base64"),
      hash = new Bun.CryptoHasher("sha256").update(b).digest("hex");
    await Bun.write(stem + "-seek-" + captures.length + ".png", b);
    delete a.image;
    await Bun.write(
      stem + "-seek-" + captures.length + ".json",
      JSON.stringify(a),
    );
    captures.push({
      time: a.time,
      imageSha256: hash,
      camera: a.drawSnapshot.cameraWorld,
    });
  }
  meta.repeatSeek = {
    captures,
    imagesEqual: captures[0].imageSha256 === captures[2].imageSha256,
    camerasEqual:
      JSON.stringify(captures[0].camera) === JSON.stringify(captures[2].camera),
  };
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  await Bun.write(stem + ".png", Buffer.from(shot.data, "base64"));
} catch (error) {
  meta.failure = String(error);
  try {
    const r = await c.evaluate(
      "replayEffectDiagnostics.stopPerformanceRecording()",
    );
    await Bun.write(stem + "-recording.json", JSON.stringify(r));
    meta.recordedFrames = r.frames.length;
  } catch {}
}
meta.events = c.events;
meta.finished = new Date().toISOString();
await Bun.write(stem + "-controls.json", JSON.stringify(meta, null, 2));
console.log(
  JSON.stringify(
    {
      failure: meta.failure,
      frames: meta.recordedFrames,
      repeatSeek: meta.repeatSeek,
      eventCount: meta.events.length,
      events: meta.events.slice(-5),
    },
    null,
    2,
  ),
);
c.close();
if (meta.failure) process.exitCode = 1;
