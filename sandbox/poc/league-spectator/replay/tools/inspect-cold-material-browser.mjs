import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const [pageUrl, debuggerUrl, outputArg] = process.argv.slice(2);
if (!pageUrl || !debuggerUrl || !outputArg)
  throw Error(
    "Usage: bun inspect-cold-material-browser.mjs <owned-loopback-page> <owned-cdp-base> <proof-directory>",
  );
for (const value of [pageUrl, debuggerUrl])
  if (new URL(value).hostname !== "127.0.0.1")
    throw Error("Owned loopback component control required");
const output = resolve(outputArg),
  pages = (await (await fetch(`${debuggerUrl}/json/list`)).json()).filter(
    (page) => page.type === "page",
  );
if (pages.length !== 1 || pages[0].url !== "about:blank")
  throw Error("One fresh isolated diagnostic browser required");
const socket = new WebSocket(pages[0].webSocketDebuggerUrl),
  pending = new Map(),
  events = [],
  responses = [];
let nextId = 0;
await new Promise((accept, reject) => {
  socket.onopen = accept;
  socket.onerror = reject;
});
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    message.error
      ? request.reject(Error(JSON.stringify(message.error)))
      : request.accept(message.result);
  } else {
    if (
      [
        "Runtime.exceptionThrown",
        "Network.loadingFailed",
        "Log.entryAdded",
      ].includes(message.method) ||
      (message.method === "Runtime.consoleAPICalled" &&
        ["warning", "error"].includes(message.params.type))
    )
      events.push(message);
    if (message.method === "Network.responseReceived")
      responses.push(message.params.response);
  }
};
function send(method, params = {}) {
  return new Promise((accept, reject) => {
    const id = ++nextId,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`CDP timeout: ${method}`));
      }, 180000);
    pending.set(id, { accept, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await Promise.all([
    send("Page.enable"),
    send("Runtime.enable"),
    send("Network.enable"),
    send("Log.enable"),
  ]);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: pageUrl });
  const result = await send("Runtime.evaluate", {
    expression: `new Promise((resolve,reject)=>{const deadline=performance.now()+150000;function inspect(){if(window.componentControl&&window.componentControl.state!=='loading')return resolve(window.componentControl);if(performance.now()>deadline)return reject(Error('Component initialization timeout'));setTimeout(inspect,100)}inspect()})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(JSON.stringify(result.exceptionDetails));
  const proof = await (await fetch(new URL("/proof.json", pageUrl))).json(),
    screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }),
    bytes = Buffer.from(screenshot.data, "base64"),
    control = {
      schema: 1,
      kind: "controlled-original-material-webgl",
      result: result.result.value,
      events,
      responses: responses.map(({ url, status, mimeType, headers }) => ({
        url,
        status,
        mimeType,
        csp:
          headers["Content-Security-Policy"] ??
          headers["content-security-policy"],
      })),
      proof,
      screenshotSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  await Bun.write(join(output, "browser.png"), bytes);
  await Bun.write(
    join(output, "browser-control.json"),
    JSON.stringify(control),
  );
  if (
    control.result?.state !== "complete" ||
    !control.result.drawCalls ||
    events.length ||
    responses.some((response) => response.status !== 200)
  )
    throw Error(
      `Controlled WebGL proof failed: ${JSON.stringify({ result: control.result, events: events.length })}`,
    );
  console.log(
    JSON.stringify({
      output,
      ...control.result,
      errors: events.length,
      responses: responses.length,
      sourceDrift: proof.sourceDrift,
    }),
  );
} finally {
  await send("Browser.close");
  socket.close();
}
