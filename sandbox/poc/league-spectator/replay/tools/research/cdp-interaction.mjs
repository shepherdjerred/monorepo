import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem =
    process.argv[2] ??
    ".cache/replay-lineup-5667809143/research/browser-cdp-v37-interaction",
  actions = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () =>
  c.evaluate(
    `({time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent,play:document.querySelector('#play').textContent,particles:document.querySelector('#particles').checked})`,
  );
async function seek(t) {
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const s=document.querySelector('#seek');s.value='${t}';s.dispatchEvent(new Event('input'));})()`,
  );
  await wait(600);
}
async function shot(name) {
  await wait(250);
  const img = await c.send("Page.captureScreenshot", { format: "png" });
  await Bun.write(stem + "-" + name + ".png", Buffer.from(img.data, "base64"));
}
async function gesture(name, button, dx, dy) {
  const r = await c.evaluate(
      `document.querySelector('canvas').getBoundingClientRect().toJSON()`,
    ),
    x = r.x + r.width * 0.5,
    y = r.y + r.height * 0.5;
  await c.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button,
    buttons: button === "left" ? 1 : 2,
    x,
    y,
    clickCount: 1,
  });
  for (let i = 1; i <= 8; i++) {
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button,
      buttons: button === "left" ? 1 : 2,
      x: x + (dx * i) / 8,
      y: y + (dy * i) / 8,
    });
    await wait(20);
  }
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button,
    buttons: 0,
    x: x + dx,
    y: y + dy,
    clickCount: 1,
  });
  await wait(600);
  actions.push({ name, state: await state() });
}
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await seek(78.5);
  await c.evaluate("replayEffectDiagnostics.startPerformanceRecording()");
  const roster = await c.evaluate(
    `[...document.querySelectorAll('#roster button')].map(x=>x.textContent)`,
  );
  for (const index of [0, 3]) {
    await c.evaluate(
      `document.querySelectorAll('#roster button')[${index}].click()`,
    );
    await wait(700);
    actions.push({
      name: "follow",
      rosterIndex: index,
      label: roster[index],
      state: await state(),
    });
  }
  await shot("before-camera");
  await gesture("orbit", "left", 180, 60);
  await shot("orbit");
  await gesture("pan", "right", 100, -35);
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
  await wait(800);
  actions.push({ name: "zoom", state: await state() });
  await shot("zoom");
  for (const t of [70, 82, 74, 82]) {
    await seek(t);
    actions.push({ name: "seek", requested: t, state: await state() });
  }
  const capture = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
  await Bun.write(
    stem + "-canvas.png",
    Buffer.from(capture.image.split(",")[1], "base64"),
  );
  delete capture.image;
  await Bun.write(stem + "-capture.json", JSON.stringify(capture));
  const raw = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  await Bun.write(stem + "-recording.json", JSON.stringify(raw));
  const vectors = raw.frames.map((x) => ({
    time: x.replayTime,
    cameraPosition: x.cameraPosition,
    cameraQuaternion: x.cameraQuaternion,
    follow: x.followEntityId,
  }));
  await Bun.write(
    stem + "-controls.json",
    JSON.stringify(
      {
        actions,
        events: c.events,
        frames: raw.frames.length,
        uniqueCameras: new Set(
          vectors.map((x) =>
            JSON.stringify([x.cameraPosition, x.cameraQuaternion]),
          ),
        ).size,
        followed: [...new Set(vectors.map((x) => x.follow))],
        pausedTimes: [...new Set(vectors.map((x) => x.time))],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        actions,
        events: c.events.length,
        frames: raw.frames.length,
        captureTime: capture.time,
        workerTime: capture.diagnostics.worker.time,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(String(error));
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
