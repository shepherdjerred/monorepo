import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem =
    process.argv[2] ??
    ".cache/replay-spike/research/browser-cdp-v38-projectile-screencast",
  frames = [],
  acks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let recording = false;
const unsubscribe = c.onEvent((event) => {
  if (event.method !== "Page.screencastFrame") return;
  const p = event.params;
  if (recording) frames.push({ data: p.data, metadata: p.metadata });
  acks.push(c.send("Page.screencastFrameAck", { sessionId: p.sessionId }));
});
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const t=document.querySelector('#seek'),s=document.querySelector('#speed');s.value='1';s.dispatchEvent(new Event('change'));t.value='79.25';t.dispatchEvent(new Event('input'));const b=[...document.querySelectorAll('#roster button')].find(b=>b.textContent.trim().startsWith('Akshan'));if(!b)throw Error('Loaded primary required');b.click()})()`,
  );
  await sleep(1200);
  const before = await c.evaluate(
    `({url:location.href,time:Number(document.querySelector('#seek').value),status:document.querySelector('#status').textContent,canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height,devicePixelRatio],timeOrigin:performance.timeOrigin})`,
  );
  if (JSON.stringify(before.canvas) !== "[1920,1080,1]")
    throw Error("Reference canvas required");
  recording = true;
  await c.send("Page.startScreencast", {
    format: "jpeg",
    quality: 80,
    maxWidth: 1440,
    maxHeight: 810,
    everyNthFrame: 1,
  });
  await c.evaluate(`document.querySelector('#play').click()`);
  await sleep(3800);
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click()})()`,
  );
  await c.send("Page.stopScreencast");
  recording = false;
  await Promise.all(acks);
  const after = await c.evaluate(
    `({time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent})`,
  );
  if (after.error) throw Error(after.error);
  const stored = [];
  for (let i = 0; i < frames.length; i++) {
    const path = stem + "-" + String(i).padStart(3, "0") + ".jpg";
    await Bun.write(path, Buffer.from(frames[i].data, "base64"));
    stored.push({ path, metadata: frames[i].metadata });
  }
  const report = {
    scope:
      "Actual CDP compositor screencast during ordinary1xPlay; capture overhead present, not performance acceptance",
    loadedSourceReference:
      ".cache/replay-spike/research/browser-cdp-v38-primary-controls.json",
    before,
    after,
    frames: stored,
    events: c.events,
  };
  await Bun.write(stem + ".json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      frames: frames.length,
      before,
      after,
      errors: c.events.length,
    }),
  );
} finally {
  unsubscribe();
  c.close();
}
