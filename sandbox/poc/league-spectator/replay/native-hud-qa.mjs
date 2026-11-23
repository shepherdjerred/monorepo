import { createLatestNativeHudCompositor } from "./latest-native-hud-compositor.mjs";

const scene = document.querySelector("#scene"),
  state = document.querySelector("#state"),
  viewport = document.querySelector("#viewport"),
  annotate = document.querySelector("#annotate"),
  status = document.querySelector("#status"),
  canvas = document.querySelector("#hud");
let compositor = null,
  fontOwner = null;
try {
  const response = await fetch("/manifest.json");
  if (!response.ok) throw Error("Original HUD QA package could not be loaded");
  const manifest = await response.json();
  compositor = await createLatestNativeHudCompositor({
    canvas,
    manifest,
    readbackForQa: true,
  });
  for (const row of manifest.scenes) {
    const option = document.createElement("option");
    option.value = `${row.baseHash}:${row.objectHash}`;
    option.textContent = row.original.name;
    scene.append(option);
  }
  scene.value = "12361360489091462774:{45c8f443}";
  function draw() {
    const [baseHash, sceneHash] = scene.value.split(":"),
      rows = manifest.primitives.filter(
        (row) => row.baseHash === baseHash && row.scene === sceneHash,
      ),
      ids = new Set(rows.map((row) => row.id)),
      unresolvedStates = [];
    // This is an explicit QA state selector using authored state membership,
    // not a claim about the native controller's current pointer/playback state.
    for (const button of manifest.buttons.filter(
      (row) => row.baseHash === baseHash && row.scene === sceneHash,
    )) {
      for (const child of button.elements)
        ids.delete(`${button.sourceSha256}:${child}`);
      const selected = button.states[state.value];
      if (!selected) {
        unresolvedStates.push(button.id);
        continue;
      }
      for (const child of selected) {
        const id = `${button.sourceSha256}:${child}`;
        if (rows.some((row) => row.id === id)) ids.add(id);
      }
    }
    // Missing authored layers use a deliberately supplied QA order0; that
    // native constructor default is not established by this harness.
    const visible = rows
        .filter((row) => ids.has(row.id))
        .sort((a, b) => (a.authoredLayer ?? 0) - (b.authoredLayer ?? 0)),
      [width, height] = viewport.value.split("×").map(Number),
      result = compositor.draw({
        width,
        height,
        visibleIds: visible.map((row) => row.id),
        annotate: annotate.checked,
      });
    status.textContent = `${result.drawn.length} original primitives · ${width}×${height} · ${manifest.unsupported.length} unsupported provider fields remain explicit`;
    document.querySelector("#omissions").textContent = JSON.stringify(
      {
        scope: manifest.scope,
        unresolvedStates,
        drawOmissions: result.omitted,
        unsupported: manifest.unsupported,
      },
      null,
      2,
    );
    window.__nativeHudQa = {
      ready: true,
      fontsLoaded: fontOwner?.fonts.length ?? 0,
      scene: scene.value,
      state: state.value,
      ...result,
      unsupported: manifest.unsupported.length,
    };
  }
  for (const control of [scene, state, viewport, annotate])
    control.addEventListener("change", draw);
  draw();
  fontOwner = await compositor.loadQaFonts();
  for (const font of fontOwner.fonts) {
    const specimen = document.createElement("p");
    specimen.style.fontFamily = font.family;
    specimen.textContent = `${font.label} · 0123456789 · Replay`;
    document.querySelector("#fonts").append(specimen);
  }
  window.__nativeHudQa.fontsLoaded = fontOwner.fonts.length;
} catch (error) {
  status.setAttribute("role", "alert");
  status.textContent = String(error);
  window.__nativeHudQa = { ready: false, error: String(error) };
}
window.addEventListener(
  "pagehide",
  () => {
    fontOwner?.close();
    compositor?.close();
  },
  { once: true },
);
