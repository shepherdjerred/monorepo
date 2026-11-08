import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem = ".cache/replay-spike/research/browser-cdp-v38-akshan-visual",
  frames = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () =>
  c.evaluate(
    `({url:location.href,status:document.querySelector('#status')?.textContent,time:Number(document.querySelector('#seek')?.value),error:document.querySelector('#error')?.textContent,play:document.querySelector('#play')?.textContent,canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height,devicePixelRatio]})`,
  );
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const initial = await state();
  if (!initial.status?.startsWith("Ready") || initial.error)
    throw Error("Loaded primary viewer required " + JSON.stringify(initial));
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const e=document.querySelector('#particles');if(!e.checked)e.click();const s=document.querySelector('#speed');s.value='1';s.dispatchEvent(new Event('change'));const t=document.querySelector('#seek');t.value='79.83333333333333';t.dispatchEvent(new Event('input'));const b=[...document.querySelectorAll('#roster button')].find(b=>b.textContent.trim().startsWith('Akshan'));if(!b)throw Error('Akshan roster entry required');b.click()})()`,
  );
  await sleep(1200);
  const capture = await c.evaluate("replayEffectDiagnostics.captureCurrent()");
  await Bun.write(
    stem + "-paused.png",
    Buffer.from(capture.image.split(",")[1], "base64"),
  );
  delete capture.image;
  await Bun.write(stem + "-paused.json", JSON.stringify(capture));
  const draws = capture.drawSnapshot?.drawDiagnostics?.packetDraws ?? [];
  const akshan = draws.filter((d) =>
    d.definitionId?.includes("champions/akshan/20/d213225a"),
  );
  if (!akshan.length) throw Error("No Akshan draw packets at selected time");
  await c.evaluate(
    `(()=>{const t=document.querySelector('#seek');t.value='79.25';t.dispatchEvent(new Event('input'))})()`,
  );
  await sleep(800);
  await c.evaluate(`document.querySelector('#play').click()`);
  for (let i = 0; i < 17; i++) {
    await sleep(80);
    const s = await state();
    if (s.error) throw Error(s.error);
    const shot = await c.send("Page.captureScreenshot", { format: "png" }),
      path = stem + "-" + String(i).padStart(2, "0") + ".png";
    await Bun.write(path, Buffer.from(shot.data, "base64"));
    frames.push({ path, state: s });
  }
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click()})()`,
  );
  const report = {
    scope:
      "Actual ordinary browser Play and paused diagnostic submission, screenshot overhead; not performance or per-instance composite-pixel coverage evidence",
    initial,
    akshanDraws: akshan.map((d) => ({
      sourceEventId: d.sourceEventId,
      definitionId: d.definitionId,
      emitterId: d.emitterId,
      ownerId: d.ownerId,
    })),
    frames,
    events: c.events,
  };
  await Bun.write(stem + ".json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      initial,
      akshanDraws: report.akshanDraws,
      frames: frames.length,
      first: frames[0].state.time,
      last: frames.at(-1).state.time,
      errors: c.events.length,
    }),
  );
} catch (error) {
  await Bun.write(
    stem + "-failure.json",
    JSON.stringify({ error: String(error), frames, events: c.events }, null, 2),
  );
  throw error;
} finally {
  c.close();
}
