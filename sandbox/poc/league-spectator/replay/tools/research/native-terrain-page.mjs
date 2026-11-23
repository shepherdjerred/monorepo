import { createTerrainRenderer } from "/terrain-renderer.mjs";

async function load(path) {
  const response = await fetch(path);
  if (!response.ok)
    throw Error(`Could not read local ${path} (${response.status})`);
  return response;
}

const status = document.querySelector("#status");
try {
  const [scene, metadata, bytes] = await Promise.all([
    load("/scene.json").then((response) => response.json()),
    load("/map.json").then((response) => response.json()),
    load("/map.bin").then((response) => response.arrayBuffer()),
  ]);
  const time = document.querySelector("#time");
  const angle = document.querySelector("#angle");
  const canvas = document.querySelector("canvas");
  const renderer = createTerrainRenderer(canvas, metadata, bytes, scene);
  const recorded = scene.frames.filter(({ markers }) => markers.length > 0);
  const frames = [...scene.frames];
  if (recorded.length >= 2)
    frames.push({
      timeSeconds: (recorded[0].timeSeconds + recorded[1].timeSeconds) / 2,
      markers: [],
    });
  frames.sort((a, b) => a.timeSeconds - b.timeSeconds);
  for (const frame of frames) {
    const label = `${frame.timeSeconds.toFixed(3)} s${frame.markers.length ? "" : " (uncaptured)"}`;
    time.add(new Option(label, String(frame.timeSeconds)));
  }
  time.value = String(recorded[0].timeSeconds);
  time.disabled = angle.disabled = false;
  function update() {
    const frame = frames.find(
      ({ timeSeconds }) => timeSeconds === Number(time.value),
    );
    renderer.draw(frame, angle.valueAsNumber);
    status.textContent = `${scene.identity.build} · ${frame.markers.length} captured camera attachments · ${scene.staticMesh.exportedMeshes} untextured meshes`;
  }
  const signals = new AbortController();
  const { signal } = signals;
  const observer = new ResizeObserver(update);
  time.addEventListener("input", update, { signal });
  angle.addEventListener("input", update, { signal });
  addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return;
      signals.abort();
      observer.disconnect();
      renderer.dispose();
    },
    { signal },
  );
  observer.observe(canvas);
  update();
} catch (error) {
  status.textContent = error.message;
  throw error;
}
