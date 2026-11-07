import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser();
try {
  const r = await c.evaluate(
    "replayEffectDiagnostics.stopPerformanceRecording()",
  );
  await Bun.write(
    ".cache/replay-spike/research/browser-cdp-v39-r2-active-interaction-failed-recording.json",
    JSON.stringify(r),
  );
  console.log(
    JSON.stringify({
      frames: r.frames.length,
      ticks: r.displayTicks?.length,
      boundary: r.boundary,
    }),
  );
} finally {
  c.close();
}
