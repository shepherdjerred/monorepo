import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem =
    process.argv[2] ??
    ".cache/replay-spike/research/browser-cdp-v39-active-interaction",
  actions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () =>
  c.evaluate(
    `({time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent,play:document.querySelector('#play').textContent,speed:Number(document.querySelector('#speed').value),canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height,devicePixelRatio]})`,
  );
async function note(name) {
  const s = await state();
  if (s.error) throw Error(s.error);
  actions.push({ name, state: s });
}
async function shot(name) {
  const s = await c.send("Page.captureScreenshot", { format: "png" });
  await Bun.write(stem + "-" + name + ".png", Buffer.from(s.data, "base64"));
}
async function seek(t) {
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const t=document.querySelector('#seek');t.value='${t}';t.dispatchEvent(new Event('input'))})()`,
  );
  await sleep(650);
  await note("seek:" + t);
}
async function gesture(name, button, dx, dy) {
  const r = await c.evaluate(
      `document.querySelector('canvas').getBoundingClientRect().toJSON()`,
    ),
    x = r.x + r.width * 0.5,
    y = r.y + r.height * 0.5,
    buttons = button === "left" ? 1 : 2;
  await c.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button,
    buttons,
    x,
    y,
    clickCount: 1,
  });
  for (let i = 1; i <= 8; i++) {
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button,
      buttons,
      x: x + (dx * i) / 8,
      y: y + (dy * i) / 8,
    });
    await sleep(20);
  }
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button,
    buttons: 0,
    x: x + dx,
    y: y + dy,
    clickCount: 1,
  });
  await sleep(200);
  await note(name);
  if (actions.at(-1).state.play.trim() !== "Pause")
    throw Error("Camera interaction unexpectedly stopped playback");
}
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
  await c.evaluate(
    `(()=>{const e=document.querySelector('#particles');if(!e.checked)e.click();const s=document.querySelector('#speed');s.value='1';s.dispatchEvent(new Event('change'))})()`,
  );
  await seek(77.5);
  const roster = await c.evaluate(
    `[...document.querySelectorAll('#roster button')].map(b=>b.textContent)`,
  );
  await c.evaluate("replayEffectDiagnostics.startPerformanceRecording()");
  await c.evaluate(
    `document.querySelector('#play').click();document.querySelectorAll('#roster button')[0].click()`,
  );
  await sleep(600);
  await note("play-follow:" + roster[0]);
  await gesture("orbit-during-play", "left", 180, 60);
  await shot("orbit");
  await gesture("pan-during-play", "right", 100, -35);
  await shot("pan");
  const r = await c.evaluate(
    `document.querySelector('canvas').getBoundingClientRect().toJSON()`,
  );
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: r.x + r.width * 0.5,
    y: r.y + r.height * 0.5,
    deltaX: 0,
    deltaY: -240,
  });
  await sleep(300);
  await note("zoom-during-play");
  await shot("zoom");
  await c.evaluate(`document.querySelectorAll('#roster button')[3].click()`);
  await sleep(500);
  await note("follow-during-play:" + roster[3]);
  await c.evaluate(
    `(()=>{const s=document.querySelector('#speed');s.value='4';s.dispatchEvent(new Event('change'))})()`,
  );
  await sleep(700);
  await note("4x-during-play");
  await c.evaluate(`document.querySelector('#play').click()`);
  await sleep(500);
  await note("paused-combat");
  const paused = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
  await Bun.write(
    stem + "-paused.png",
    Buffer.from(paused.image.split(",")[1], "base64"),
  );
  delete paused.image;
  await Bun.write(stem + "-paused.json", JSON.stringify(paused));
  for (const t of [74, 93, 79.85, 74, 79.85]) await seek(t);
  const capture = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
  await Bun.write(
    stem + "-seek.png",
    Buffer.from(capture.image.split(",")[1], "base64"),
  );
  delete capture.image;
  await Bun.write(stem + "-seek.json", JSON.stringify(capture));
  const recording = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  await Bun.write(stem + "-recording.json", JSON.stringify(recording));
  if (
    capture.time !== 79.85 ||
    capture.diagnostics.worker.time !== capture.time
  )
    throw Error("Paused seek capture world/worker time differs");
  await Bun.write(
    stem + "-controls.json",
    JSON.stringify(
      {
        scope:
          "Actual ordinary Play interactions with screenshot/manual GPU diagnostic overhead; not clean FPS acceptance",
        actions,
        roster,
        events: c.events,
        frames: recording.frames.length,
        displayTicks: recording.displayTicks?.length,
        finalCaptureTime: capture.time,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      actions,
      frames: recording.frames.length,
      displayTicks: recording.displayTicks?.length,
      errors: c.events.length,
    }),
  );
} catch (error) {
  await Bun.write(
    stem + "-failure.json",
    JSON.stringify(
      { error: String(error), actions, events: c.events },
      null,
      2,
    ),
  );
  throw error;
} finally {
  c.close();
}
