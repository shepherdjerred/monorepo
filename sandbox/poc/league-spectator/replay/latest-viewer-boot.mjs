import { createLatestViewerEngine } from "./latest-viewer.mjs";

const engine = createLatestViewerEngine({
  canvas: document.getElementById("scene"),
  viewport: document.getElementById("viewport"),
  getElement: (id) => document.getElementById(id),
});
globalThis.replayEffectDiagnostics = engine.diagnostics;
globalThis.replayViewerEngine = engine;
window.addEventListener("pagehide", () => engine.dispose(), { once: true });
