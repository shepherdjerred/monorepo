export async function connectReplayBrowser() {
  const base = "http://127.0.0.1:9222",
    pages = (await (await fetch(base + "/json/list")).json()).filter(
      (t) => t.type === "page",
    );
  if (pages.length !== 1)
    throw Error("One isolated replay browser target required");
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl),
    pending = new Map(),
    events = [],
    scriptResponses = [],
    listeners = new Set();
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
    } else {
      for (const listener of listeners) listener(m);
      if (m.method === "Network.responseReceived" && m.params.type === "Script")
        scriptResponses.push({
          requestId: m.params.requestId,
          url: m.params.response.url,
          status: m.params.response.status,
        });
      if (
        m.method === "Runtime.exceptionThrown" ||
        m.method === "Network.loadingFailed" ||
        m.method === "Log.entryAdded" ||
        (m.method === "Runtime.consoleAPICalled" &&
          ["error", "warning"].includes(m.params.type)) ||
        (m.method === "Network.responseReceived" &&
          m.params.response.status >= 400)
      )
        events.push(m);
    }
  };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const key = ++id,
        timer = setTimeout(() => {
          pending.delete(key);
          reject(Error("CDP timeout: " + method));
        }, 15000);
      pending.set(key, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          id: key,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
    });
  }
  async function evaluate(expression, sessionId) {
    const r = await send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
      sessionId,
    );
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
    send("Log.enable"),
  ]);
  await send("Runtime.discardConsoleEntries");
  await send("Log.clear");
  events.length = 0;
  return {
    send,
    evaluate,
    events,
    scriptResponses,
    onEvent(listener) {
      if (typeof listener !== "function")
        throw Error("CDP event listener required");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      ws.close();
    },
  };
}
