import { connectReplayBrowser } from "./cdp-client.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4180";
const stem = process.argv[3];
if (!stem || process.argv.length !== 4)
  throw Error("Usage: bun cdp-initialization-gate.mjs <origin> <output-stem>");
if (await Bun.file(stem + "-controls.json").exists())
  throw Error("Preserve earlier initialization evidence");
const c = await connectReplayBrowser();
const report = {
  origin,
  scope: "Controlled delayed initialization; not FPS evidence",
};
let held = null;
let released = false;
let callbackFailure = null;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = () =>
  c.evaluate(
    `({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,playDisabled:document.querySelector('#play')?.disabled,seekDisabled:document.querySelector('#seek')?.disabled,loadDisabled:document.querySelector('#load')?.disabled,play:document.querySelector('#play')?.textContent,time:Number(document.querySelector('#seek')?.value),canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height,devicePixelRatio]})`,
  );
async function until(predicate) {
  const started = Date.now();
  for (;;) {
    if (callbackFailure) throw Error(callbackFailure);
    const value = await state();
    if (value.error) throw Error(value.error);
    if (predicate(value)) return value;
    if (Date.now() - started > 150000)
      throw Error(
        "Initialization condition timed out: " + JSON.stringify(value),
      );
    await pause(200);
  }
}
const unsubscribe = c.onEvent((event) => {
  if (event.method !== "Fetch.requestPaused") return;
  if (!held) held = event.params;
  else
    c.send("Fetch.continueRequest", {
      requestId: event.params.requestId,
    }).catch((error) => {
      callbackFailure = String(error);
    });
});
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  await c.send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*latest-direct-static-mesh-resources/package.json*",
        requestStage: "Request",
      },
    ],
  });
  const navigation = await c.send("Page.navigate", {
    url: origin + "/latest.html",
  });
  for (;;) {
    const tree = await c.send("Page.getFrameTree");
    if (tree.frameTree.frame.loaderId === navigation.loaderId) break;
    await pause(50);
  }
  await until((value) => value.loadDisabled === false);
  await c.evaluate("document.querySelector('#load').click()");
  report.whileHeld = await until(() => held !== null);
  report.heldUrl = held.request.url;
  if (
    !report.whileHeld.playDisabled ||
    !report.whileHeld.seekDisabled ||
    report.whileHeld.status.startsWith("Ready")
  )
    throw Error("Playback admitted before shared effects initialized");
  await c.evaluate("document.querySelector('#play').click()");
  report.afterDisabledClick = await state();
  if (
    report.afterDisabledClick.play.trim() !== "Play" ||
    report.afterDisabledClick.time !== report.whileHeld.time
  )
    throw Error("Disabled Play advanced the replay during initialization");
  await c.send("Fetch.continueRequest", { requestId: held.requestId });
  released = true;
  await c.send("Fetch.disable");
  report.ready = await until(
    (value) =>
      value.status?.startsWith("Ready") &&
      !value.playDisabled &&
      !value.seekDisabled &&
      !value.loadDisabled,
  );
  await c.evaluate("document.querySelector('#play').click()");
  report.playing = await until((value) => value.time >= report.ready.time + 1);
  if (report.playing.play.trim() !== "Pause")
    throw Error("Play state and button label differ");
  await c.evaluate(
    "document.querySelector('#play').click();const seek=document.querySelector('#seek');seek.value='79.85';seek.dispatchEvent(new Event('input'))",
  );
  await until((value) => value.play.trim() === "Play" && value.time === 79.85);
  const captured = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
  await Bun.write(
    stem + "-canvas.png",
    Buffer.from(captured.image.split(",")[1], "base64"),
  );
  delete captured.image;
  await Bun.write(stem + "-capture.json", JSON.stringify(captured));
  const rect = await c.evaluate(
    "document.querySelector('canvas').getBoundingClientRect().toJSON()",
  );
  const thumbnail = await c.send("Page.captureScreenshot", {
    format: "png",
    clip: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scale: 0.5,
    },
  });
  await Bun.write(stem + "-preview.png", Buffer.from(thumbnail.data, "base64"));
  report.pass = true;
} catch (error) {
  report.failure = String(error);
  report.pass = false;
} finally {
  if (held && !released)
    await c
      .send("Fetch.continueRequest", { requestId: held.requestId })
      .catch(() => {});
  await c.send("Fetch.disable").catch(() => {});
  unsubscribe();
  report.events = c.events;
  const source = new URL("../../latest-viewer.mjs", import.meta.url);
  report.viewerSourceSha256 = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(source).bytes())
    .digest("hex");
  await Bun.write(stem + "-controls.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      pass: report.pass,
      failure: report.failure,
      held: report.whileHeld,
      ready: report.ready,
      errors: c.events.length,
    }),
  );
  c.close();
}
if (!report.pass) process.exitCode = 1;
