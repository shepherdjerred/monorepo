import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem = ".cache/replay-lineup-5667809143/research/browser-cdp-decode";
await c.evaluate(`document.getElementById('load').click(); true`);
let state,
  previous = "";
for (let n = 0; n < 120; n++) {
  state = await c.evaluate(
    `({status:document.getElementById('status').textContent,error:document.getElementById('error').textContent,playDisabled:document.getElementById('play').disabled,play:document.getElementById('play').textContent,clock:document.getElementById('clock').textContent,particleStatus:document.getElementById('particle-status').textContent,roster:[...document.querySelectorAll('#roster button')].map(b=>b.textContent)})`,
  );
  if (state.status !== previous) {
    console.log(JSON.stringify(state));
    previous = state.status;
  }
  if (state.error || !state.playDisabled) break;
  await new Promise((r) => setTimeout(r, 500));
}
const screenshot = await c.send("Page.captureScreenshot", { format: "png" });
await Bun.write(stem + ".png", Buffer.from(screenshot.data, "base64"));
await Bun.write(
  stem + ".json",
  JSON.stringify(
    { headless: true, isolatedProfile: true, state, events: c.events },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    state,
    events: c.events.map((e) => ({
      method: e.method,
      message:
        e.params.exceptionDetails?.exception?.description ??
        e.params.errorText ??
        e.params.args?.map((a) => a.value ?? a.description).join(" ") ??
        e.params.entry?.text,
      status: e.params.response?.status,
      url: e.params.response?.url,
    })),
    screenshot: stem + ".png",
  }),
);
c.close();
if (state.playDisabled || state.error)
  throw Error("Browser replay did not become playable");
