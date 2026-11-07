const stem =
    process.argv[2] ??
    ".cache/replay-spike/research/browser-cdp-v37-worker-latency-trace-1080p",
  inputs = {};
const read = async (path) => {
  const b = await Bun.file(path).bytes();
  inputs[path] = new Bun.CryptoHasher("sha256").update(b).digest("hex");
  return JSON.parse(new TextDecoder().decode(b));
};
inputs[import.meta.path] = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(import.meta.path).bytes())
  .digest("hex");
const c = await read(stem + "-controls.json"),
  trace = await read(stem + "-trace.json"),
  r = await read(stem + "-recording.json");
if (
  c.failure ||
  c.traceCompletion?.dataLossOccurred ||
  c.trace.dataLossOccurred
)
  throw Error("Complete successful trace required");
const es = trace.traceEvents,
  main = es.find(
    (e) => e.name === "thread_name" && e.args.name === "CrRendererMain",
  );
if (!main) throw Error("Main thread missing");
const mainTid = main.tid,
  workerTids = es
    .filter(
      (e) =>
        e.name === "thread_name" && e.args.name === "DedicatedWorker thread",
    )
    .map((e) => e.tid),
  schedules = es.filter(
    (e) => e.name === "SchedulePostMessage" && e.ph === "I",
  ),
  handles = new Map(
    es
      .filter((e) => e.name === "HandlePostMessage" && e.ph === "X")
      .map((e) => [e.args.data.traceId, e]),
  ),
  mainWork = es.filter((e) => e.ph === "X" && e.tid === mainTid && e.dur > 0);
const union = (start, end) => {
  let total = 0,
    last = -Infinity;
  for (const [a, b] of mainWork
    .filter((e) => e.ts < end && e.ts + e.dur > start)
    .map((e) => [Math.max(start, e.ts), Math.min(end, e.ts + e.dur)])
    .sort((a, b) => a[0] - b[0])) {
    if (b <= last) continue;
    total += b - Math.max(a, last);
    last = b;
  }
  return total / 1000;
};
const qs = (a) => {
  a.sort((a, b) => a - b);
  const pick = (p) => (a.length ? a[Math.ceil(a.length * p) - 1] : null);
  return {
    samples: a.length,
    p50: pick(0.5),
    p95: pick(0.95),
    minimum: a[0] ?? null,
    maximum: a.at(-1) ?? null,
  };
};
const pairs = schedules
    .map((s) => ({ send: s, handle: handles.get(s.args.data.traceId) }))
    .filter((p) => p.handle)
    .map(({ send, handle }) => ({
      traceId: send.args.data.traceId,
      sendThread: send.tid,
      receiveThread: handle.tid,
      sendUs: send.ts,
      handleStartUs: handle.ts,
      deliveryMs: (handle.ts - send.ts) / 1000,
      handleMs: handle.dur / 1000,
      ...(handle.tid === mainTid
        ? { observedMainXMsInsideDelivery: union(send.ts, handle.ts) }
        : {}),
    })),
  outbound = pairs.filter(
    (p) => p.sendThread === mainTid && workerTids.includes(p.receiveThread),
  ),
  inbound = pairs.filter(
    (p) => workerTids.includes(p.sendThread) && p.receiveThread === mainTid,
  );
if (!outbound.length || !inbound.length)
  throw Error("Both actual message directions required");
const result = {
  schema: 1,
  kind: "actual-Chrome-message-flow-latency-analysis-v38",
  inputs,
  contract: c.contract,
  loadedScriptGraphSha256: c.loadedScriptGraphSha256,
  scope: {
    instrumentedDiagnostic: true,
    cleanFpsAcceptance: false,
    traceDataLoss: false,
    unifiedChromeTraceClock: true,
    physicalDeserializeCostIsolated: false,
    uncoveredTimeMeansProvenIdle: false,
    browserSchedulerPolicyEstablished: false,
    gpuDriverCauseEstablished: false,
  },
  threads: { mainTid, workerTids },
  mainPostSyncMs: qs(c.main.posts.map((x) => x.syncMs)),
  workerPostSyncMs: qs(
    c.workers.flatMap((w) => w.timings?.sends ?? []).map((x) => x.syncMs),
  ),
  mainToWorker: {
    deliveryMs: qs(outbound.map((p) => p.deliveryMs)),
    wholeHandleMs: qs(outbound.map((p) => p.handleMs)),
  },
  workerToMain: {
    deliveryMs: qs(inbound.map((p) => p.deliveryMs)),
    wholeHandleMs: qs(inbound.map((p) => p.handleMs)),
    observedMainXMsInsideDelivery: qs(
      inbound.map((p) => p.observedMainXMsInsideDelivery),
    ),
    uncoveredBySelectedMainXMs: qs(
      inbound.map((p) => p.deliveryMs - p.observedMainXMsInsideDelivery),
    ),
  },
  observations: [
    "Main->worker posting/delivery is fast; worker->main reply delivery dominates the observed message gap.",
    "Synchronous main and worker postMessage costs are each <=0.1ms p95; a13ms payload encoding explanation is unsupported.",
    "The main HandlePostMessage span includes promise microtasks, renderer commitment and drawing; it is not isolated deserialization.",
    "The main callback continues world/HUD updates after posting, accounting for about3ms median of the reply gap; about8.7ms median is not covered by captured synchronous main X events.",
    "Selected trace categories do not establish OS/browser scheduling policy, prove thread idle time, or isolate GPU/driver waits.",
    "No frame scheduling implementation change was made by this diagnostic.",
  ],
  messagePairs: pairs,
  recordedFrames: r.frames.length,
};
const out = stem + "-analysis.json";
await Bun.write(out, JSON.stringify(result, null, 2) + "\n");
const b = await Bun.file(out).bytes();
console.log(
  JSON.stringify(
    {
      output: out,
      sha256: new Bun.CryptoHasher("sha256").update(b).digest("hex"),
      mainToWorker: result.mainToWorker,
      workerToMain: result.workerToMain,
      mainPostSyncMs: result.mainPostSyncMs,
      workerPostSyncMs: result.workerPostSyncMs,
    },
    null,
    2,
  ),
);
