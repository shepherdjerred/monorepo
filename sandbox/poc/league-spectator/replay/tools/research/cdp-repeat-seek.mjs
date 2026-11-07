import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  rows = [],
  stem =
    ".cache/replay-lineup-5667809143/research/browser-cdp-v37-repeated-seek";
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const t of [82.35, 74, 82.35]) {
    await c.evaluate(
      `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const s=document.querySelector('#seek');s.value='${t}';s.dispatchEvent(new Event('input'));})()`,
    );
    await new Promise((r) => setTimeout(r, 1600));
    const a = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
    const bytes = Buffer.from(a.image.split(",")[1], "base64");
    const imageSha256 = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex");
    const i = rows.length;
    await Bun.write(stem + "-" + i + ".png", bytes);
    delete a.image;
    await Bun.write(stem + "-" + i + ".json", JSON.stringify(a));
    rows.push({
      time: a.time,
      workerTime: a.diagnostics.worker.time,
      imageSha256,
      camera: a.drawSnapshot.cameraWorld,
      projection: a.drawSnapshot.cameraProjection,
    });
  }
  const out = {
    scope:
      "actual paused browser canvas captures; no original League visual comparison",
    rows,
    repeatedCanvasBytesEqual: rows[0].imageSha256 === rows[2].imageSha256,
    repeatedCameraEqual:
      JSON.stringify(rows[0].camera) === JSON.stringify(rows[2].camera),
    events: c.events,
  };
  await Bun.write(stem + ".json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
} finally {
  c.close();
}
