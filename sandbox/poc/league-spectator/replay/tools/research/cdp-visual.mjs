import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem = ".cache/replay-lineup-5667809143/research/browser-cdp-v37-visual",
  frames = [];
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const t=document.querySelector('#seek'),s=document.querySelector('#speed');s.value='1';s.dispatchEvent(new Event('change'));t.value='77.5';t.dispatchEvent(new Event('input'));document.querySelectorAll('#roster button')[0].click()})()`,
  );
  await new Promise((r) => setTimeout(r, 800));
  await c.evaluate(`document.querySelector('#play').click()`);
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const state = await c.evaluate(
      `({time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent,particles:document.querySelector('#particle-status').textContent})`,
    );
    if (state.error) throw Error(state.error);
    const shot = await c.send("Page.captureScreenshot", { format: "png" }),
      path = stem + "-" + String(i).padStart(2, "0") + ".png";
    await Bun.write(path, Buffer.from(shot.data, "base64"));
    frames.push({ path, state });
  }
  await c.evaluate(`document.querySelector('#play').click()`);
  await Bun.write(
    stem + ".json",
    JSON.stringify(
      {
        scope:
          "actual CDP browser visual capture, screenshot overhead present; not timing evidence",
        frames,
        events: c.events,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      frames: frames.length,
      first: frames[0].state,
      last: frames.at(-1).state,
      errors: c.events.length,
    }),
  );
} finally {
  c.close();
}
