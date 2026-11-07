const base = "http://127.0.0.1:9222";
const tabs = await (await fetch(base + "/json/list")).json();
const pages = tabs.filter((t) => t.type === "page");
if (pages.length !== 1)
  throw Error("One isolated replay browser target required");
const ws = new WebSocket(pages[0].webSocketDebuggerUrl),
  pending = new Map(),
  events = [];
let id = 0;
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (
    m.method === "Runtime.exceptionThrown" ||
    m.method === "Network.loadingFailed" ||
    (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") ||
    (m.method === "Network.responseReceived" && m.params.response.status >= 400)
  )
    events.push(m);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id,
      timer = setTimeout(() => {
        pending.delete(key);
        reject(Error("CDP timeout: " + method));
      }, 15000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
    );
  return r.result.value;
}
await Promise.all([
  send("Page.enable"),
  send("Runtime.enable"),
  send("Network.enable"),
]);
await send("Runtime.discardConsoleEntries");
events.length = 0;
await send("Page.navigate", { url: "http://127.0.0.1:4181/latest.html" });
const expression = `({title:document.title,url:location.href,status:document.getElementById('status')?.textContent,error:document.getElementById('error')?.textContent,loadDisabled:document.getElementById('load')?.disabled,clock:document.getElementById('clock')?.textContent,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height}))})`;
let state;
for (let n = 0; n < 60; n++) {
  state = await evaluate(expression);
  if (state.error || state.loadDisabled === false) break;
  await new Promise((r) => setTimeout(r, 500));
}
const screenshot = await send("Page.captureScreenshot", { format: "png" });
const stem = ".cache/replay-lineup-5667809143/research/browser-cdp-map-ready";
await Bun.write(stem + ".png", Buffer.from(screenshot.data, "base64"));
const version = await (await fetch(base + "/json/version")).json();
await Bun.write(
  stem + ".json",
  JSON.stringify(
    {
      headless: true,
      isolatedProfile: true,
      state,
      events,
      browser: { name: version.Browser, protocol: version["Protocol-Version"] },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    connected: true,
    state,
    errors: events.map((e) => ({
      method: e.method,
      message:
        e.params.exceptionDetails?.exception?.description ??
        e.params.errorText ??
        e.params.args?.map((a) => a.value ?? a.description).join(" "),
      status: e.params.response?.status,
      url: e.params.response?.url,
    })),
    screenshot: stem + ".png",
  }),
);
ws.close();
if (state.loadDisabled !== false || state.error)
  throw Error("Browser map did not become ready");
