import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem = ".cache/replay-spike/research/browser-cdp-v37-interleaved-world-fx",
  rows = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const t of [82.35, 74, 82.35]) {
    await c.evaluate(
      `(()=>{const p=document.querySelector('#play'),e=document.querySelector('#particles'),s=document.querySelector('#seek');if(p.textContent.trim()==='Pause')p.click();if(e.checked)e.click();s.value='${t}';s.dispatchEvent(new Event('input'));})()`,
    );
    await sleep(1200);
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    await Bun.write(
      stem + "-world-" + rows.length + ".png",
      Buffer.from(shot.data, "base64"),
    );
    await c.evaluate(`document.querySelector('#particles').click()`);
    const a = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
    await Bun.write(
      stem + "-fx-" + rows.length + ".png",
      Buffer.from(a.image.split(",")[1], "base64"),
    );
    delete a.image;
    await Bun.write(stem + "-fx-" + rows.length + ".json", JSON.stringify(a));
    rows.push({
      time: a.time,
      workerTime: a.diagnostics.worker.time,
      source: c.scriptResponses,
    });
  }
  await Bun.write(
    stem + ".json",
    JSON.stringify(
      {
        scope:
          "interleaved paused world-only compositor then directFXcapture, same replay time/camera; diagnostics intentionally read back GPU buffers",
        rows,
        events: c.events,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ rows, events: c.events.length }));
} finally {
  c.close();
}
