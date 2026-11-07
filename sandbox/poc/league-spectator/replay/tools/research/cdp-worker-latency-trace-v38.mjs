import { connectReplayBrowser } from "./cdp-client.mjs";
const stem =
    process.argv[2] ??
    ".cache/replay-spike/research/browser-cdp-v37-worker-latency-trace",
  reference =
    process.argv[3] ??
    ".cache/replay-spike/research/browser-cdp-v37-gpu-diagnostics-primary-controls.json";
const LIMIT = 32 * 1024 * 1024,
  c = await connectReplayBrowser(),
  meta = {
    schema: 1,
    kind: "instrumented-worker-delivery-Chrome-trace",
    started: new Date().toISOString(),
    scope: {
      diagnosticInstrumentation: true,
      cleanFpsGate: false,
      productionSourceFilesChanged: false,
      runtimeMeasurementHooksInstalled: true,
      workerMessagesUnchanged: true,
      worldCameraOrGeometrySubstituted: false,
      physicalTransferTimeIsolated: false,
    },
    workers: [],
    events: [],
  };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
let tracing = false,
  recording = false,
  restoreMain = false,
  traceCompletion = null,
  completeResolve,
  unsubscribe;
const workerInstalls = [],
  workerSessions = new Map(),
  scripts = [];
const mainInstall = `(()=>{if(globalThis.__scoutFrameTrace)throw Error('Trace already installed');const native=Worker.prototype.postMessage,seen=new WeakSet(),listeners=[],state={posts:[],replies:[],overflow:false};const push=(key,row)=>{if(state[key].length>=2000)state.overflow=true;else state[key].push(row)};function wrapper(...args){const message=args[0],match=message?.version===1&&['advance','camera'].includes(message.type);if(match&&!seen.has(this)){seen.add(this);const listener=e=>{if(e.data?.version===1&&typeof e.data.ok==='boolean')push('replies',{id:e.data.id,at:performance.now(),phase:'listener after pre-existing client onmessage; before promise continuation'})};this.addEventListener('message',listener);listeners.push([this,listener])}const start=performance.now();try{return Reflect.apply(native,this,args)}finally{if(match)push('posts',{id:message.id,type:message.type,replayTime:message.payload?.time??null,start,syncMs:performance.now()-start})}}Worker.prototype.postMessage=wrapper;globalThis.__scoutFrameTrace={state,restore(){if(Worker.prototype.postMessage!==wrapper)throw Error('Worker postMessage changed during trace');Worker.prototype.postMessage=native;for(const[w,l]of listeners)w.removeEventListener('message',l);delete globalThis.__scoutFrameTrace}};return{installed:true}})()`;
const workerInstall = `(()=>{if(globalThis.__scoutWorkerSendTrace)throw Error('Worker trace already installed');const native=globalThis.postMessage,own=Object.getOwnPropertyDescriptor(globalThis,'postMessage'),state={sends:[],overflow:false};function wrapper(...args){const message=args[0],match=message?.version===1&&message.ok===true&&Array.isArray(message.result?.draws),start=performance.now();try{return Reflect.apply(native,this,args)}finally{if(match){if(state.sends.length>=2000)state.overflow=true;else state.sends.push({id:message.id,start,syncMs:performance.now()-start,draws:message.result.draws.length})}}}globalThis.postMessage=wrapper;globalThis.__scoutWorkerSendTrace={state,restore(){if(globalThis.postMessage!==wrapper)throw Error('Worker postMessage changed during trace');if(own)Object.defineProperty(globalThis,'postMessage',own);else delete globalThis.postMessage;delete globalThis.__scoutWorkerSendTrace}};return{installed:true}})()`;
const state = () =>
  c.evaluate(
    `({url:location.href,time:Number(document.querySelector('#seek').value),playing:document.querySelector('#play').textContent.trim()==='Pause',effects:document.querySelector('#particles').checked,speed:Number(document.querySelector('#speed').value),error:document.querySelector('#error').textContent,canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height,devicePixelRatio],visible:document.visibilityState,focused:document.hasFocus()})`,
  );
async function finishTrace() {
  if (!tracing) return;
  let timer;
  const finished = new Promise((resolve, reject) => {
    completeResolve = resolve;
    timer = setTimeout(
      () => reject(Error("Tracing completion timeout")),
      15000,
    );
  });
  try {
    await c.send("Tracing.end");
    tracing = false;
    traceCompletion = await finished;
  } finally {
    clearTimeout(timer);
    completeResolve = null;
  }
  const handle = traceCompletion.stream;
  if (!handle) throw Error("Trace stream missing");
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const r = await c.send("IO.read", { handle, size: 262144 }),
        b = Buffer.from(r.data, r.base64Encoded ? "base64" : "utf8");
      total += b.length;
      if (total > LIMIT) throw Error("Trace exceeds strict32MiB cap");
      chunks.push(b);
      if (r.eof) break;
    }
  } finally {
    await c.send("IO.close", { handle });
  }
  if (traceCompletion.dataLossOccurred)
    throw Error("Trace data loss: incomplete timeline rejected");
  const bytes = Buffer.concat(chunks);
  JSON.parse(bytes.toString("utf8"));
  await Bun.write(stem + "-trace.json", bytes);
  meta.trace = {
    path: stem + "-trace.json",
    bytes: bytes.length,
    sha256: hash(bytes),
    dataLossOccurred: false,
  };
}
try {
  const refBytes = await Bun.file(reference).bytes(),
    ref = JSON.parse(new TextDecoder().decode(refBytes));
  meta.moduleGraphReference = {
    path: reference,
    sha256: hash(refBytes),
    scripts: ref.scripts,
    scope:
      "Reference last GPU-v2 navigation graph; current loaded script ids/hashes separately captured via Debugger, no reload",
  };
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(500);
  meta.initial = await state();
  if (
    !meta.initial.url.startsWith(ref.origin + "/") ||
    JSON.stringify(meta.initial.canvas) !== "[1920,1080,1]" ||
    meta.initial.visible !== "visible"
  )
    throw Error("Current loaded reference page/display mismatch");
  unsubscribe = c.onEvent((m) => {
    if (m.method === "Debugger.scriptParsed" && m.params.url.startsWith("http"))
      scripts.push({
        sessionId: m.sessionId ?? null,
        scriptId: m.params.scriptId,
        url: m.params.url,
        hash: m.params.hash,
        length: m.params.length,
      });
    if (m.method === "Tracing.tracingComplete") completeResolve?.(m.params);
    if (
      m.method === "Target.attachedToTarget" &&
      m.params.targetInfo.type === "worker" &&
      new URL(m.params.targetInfo.url).pathname.endsWith(
        "/latest-direct-effect-worker.mjs",
      )
    ) {
      const sessionId = m.params.sessionId;
      workerSessions.set(sessionId, m.params.targetInfo);
      workerInstalls.push(
        c
          .evaluate(workerInstall, sessionId)
          .then((result) =>
            meta.workers.push({
              sessionId,
              target: m.params.targetInfo,
              result,
            }),
          )
          .catch((error) =>
            meta.workers.push({
              sessionId,
              target: m.params.targetInfo,
              boundary: String(error),
            }),
          ),
      );
    }
  });
  await c.send("Debugger.enable");
  await sleep(100);
  await c.send("Debugger.disable");
  meta.loadedScripts = scripts;
  meta.loadedScriptGraphSha256 = hash(
    Buffer.from(
      JSON.stringify(
        scripts
          .map(({ url, hash, sessionId }) => ({ url, hash, sessionId }))
          .sort((a, b) => a.url.localeCompare(b.url)),
      ),
    ),
  );
  await c.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [{ type: "worker" }],
  });
  await sleep(250);
  await Promise.all(workerInstalls);
  meta.optionalWorkerSendTiming = meta.workers.some((w) => w.result?.installed)
    ? "installed"
    : "existing direct worker not attached; boundary remains explicit";
  await c.evaluate(mainInstall);
  restoreMain = true;
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play'),e=document.querySelector('#particles'),s=document.querySelector('#speed'),t=document.querySelector('#seek');if(p.textContent.trim()==='Pause')p.click();if(!e.checked)e.click();s.value='1';s.dispatchEvent(new Event('change'));t.value='69';t.dispatchEvent(new Event('input'));})()`,
  );
  await sleep(1200);
  meta.contract = await c.evaluate(
    "replayEffectDiagnostics.startPerformanceRecording()",
  );
  recording = true;
  if (meta.contract.runtimeProgramVersion !== 37)
    throw Error("Expected existing loaded37 page, not a38 reload");
  // Remove pre-window initialization/seek observations without changing state.
  await c.evaluate(
    "(()=>{const s=__scoutFrameTrace.state;s.posts=[];s.replies=[];s.overflow=false})()",
  );
  for (const sessionId of workerSessions.keys())
    await c.evaluate(
      "(()=>{if(globalThis.__scoutWorkerSendTrace){globalThis.__scoutWorkerSendTrace.state.sends=[];globalThis.__scoutWorkerSendTrace.state.overflow=false}})()",
      sessionId,
    );
  await c.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    traceConfig: {
      recordMode: "recordUntilFull",
      traceBufferSizeInKb: 32768,
      includedCategories: ["devtools.timeline", "v8", "blink.user_timing"],
      enableSampling: true,
    },
  });
  tracing = true;
  await c.evaluate(
    `(()=>{performance.mark('scout-worker-trace-play-start');document.querySelector('#play').click()})()`,
  );
  const start = Date.now();
  for (;;) {
    await sleep(100);
    const s = await state();
    if (s.error) throw Error(JSON.stringify(s));
    if (s.time >= 73) {
      meta.end = s;
      break;
    }
    if (Date.now() - start > 20000) throw Error("Trace playback timeout");
  }
  await c.evaluate(
    `(()=>{performance.mark('scout-worker-trace-play-end');const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click()})()`,
  );
  await finishTrace();
  const rec = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  recording = false;
  await Bun.write(stem + "-recording.json", JSON.stringify(rec));
  meta.recording = {
    path: stem + "-recording.json",
    frames: rec.frames.length,
    fullReferenceWindow: false,
  };
  meta.main = await c.evaluate("__scoutFrameTrace.state");
  for (const [sessionId, target] of workerSessions) {
    try {
      meta.workers.find((w) => w.sessionId === sessionId).timings =
        await c.evaluate(
          "globalThis.__scoutWorkerSendTrace?.state??null",
          sessionId,
        );
    } catch (error) {
      meta.workers.find((w) => w.sessionId === sessionId).readBoundary =
        String(error);
    }
  }
  if (meta.main.overflow || meta.workers.some((w) => w.timings?.overflow))
    throw Error("Instrumentation row capacity exceeded");
  if (!meta.main.posts.length)
    throw Error("No actual direct worker posts measured");
} catch (error) {
  meta.failure = String(error);
  try {
    await finishTrace();
  } catch (e) {
    meta.traceFailure = String(e);
  }
} finally {
  if (recording)
    try {
      await c.evaluate("replayEffectDiagnostics.stopPerformanceRecording()");
    } catch (e) {
      meta.recordingCleanup = String(e);
    }
  if (restoreMain)
    try {
      await c.evaluate("__scoutFrameTrace.restore()");
    } catch (e) {
      meta.mainRestoreFailure = String(e);
    }
  for (const sessionId of workerSessions.keys())
    try {
      await c.evaluate(
        "globalThis.__scoutWorkerSendTrace?.restore()",
        sessionId,
      );
    } catch (e) {
      meta.workerRestoreFailure = String(e);
    }
  try {
    await c.send("Target.setAutoAttach", {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  } catch (e) {
    meta.detachFailure = String(e);
  }
  if (
    meta.mainRestoreFailure ||
    meta.workerRestoreFailure ||
    meta.detachFailure ||
    meta.recordingCleanup
  )
    meta.failure ??=
      "Instrumentation cleanup failed; see explicit cleanup boundary";
  unsubscribe?.();
  meta.events = c.events;
  meta.finished = new Date().toISOString();
  meta.traceCompletion = traceCompletion;
  await Bun.write(stem + "-controls.json", JSON.stringify(meta, null, 2));
  console.log(
    JSON.stringify({
      output: stem + "-controls.json",
      failure: meta.failure,
      trace: meta.trace,
      workerTiming: meta.optionalWorkerSendTiming,
      mainPosts: meta.main?.posts.length,
      events: meta.events.length,
    }),
  );
  c.close();
  if (meta.failure) process.exitCode = 1;
}
