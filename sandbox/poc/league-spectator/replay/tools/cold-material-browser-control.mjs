// Explicitly supplied geometry exercises material resources, never replay state.
import * as THREE from "three";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestSelectedMaterialRegistry } from "../latest-selected-materials.mjs";
import { LatestParentVfxRenderer } from "../latest-parent-renderer.mjs";
import { writeReplayCameraBlocks } from "../latest-vfx-bound-renderer.mjs";

const status = document.querySelector("#status"),
  canvas = document.querySelector("canvas"),
  labels = document.querySelector("#materials");
window.componentControl = { state: "loading" };
async function load(file) {
  const response = await fetch(`/assets/${file}`);
  if (response.status !== 200)
    throw Error(`Resource HTTP ${response.status}: ${file}`);
  return new Uint8Array(await response.arrayBuffer());
}
try {
  const selection = await loadLatestStaticCatalogSelection({ load }),
    bytes = await selection.readRole("effects"),
    manifest = JSON.parse(new TextDecoder().decode(bytes)),
    quad = JSON.parse(
      new TextDecoder().decode(await selection.readRole("quadGpu")),
    ),
    registry = await loadLatestSelectedMaterialRegistry({
      staticCatalog: selection,
      load,
    }),
    scene = new THREE.Scene(),
    owner = new LatestParentVfxRenderer(scene, manifest, bytes, {
      staticCatalog: selection,
      selectedMaterials: registry,
    }),
    gpu = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    }),
    gl = gpu.getContext(),
    shaderErrors = [];
  gpu.debug.onShaderError = (context, program, vertex, pixel) => {
    shaderErrors.push({
      program: context.getProgramInfoLog(program),
      vertex: context.getShaderInfoLog(vertex),
      pixel: context.getShaderInfoLog(pixel),
    });
  };
  gpu.setPixelRatio(1);
  gpu.setSize(1080, 600, false);
  gpu.setClearColor(0x18202b, 1);
  await owner.load([...new Set(quad.emitters.map((row) => row.effectId))]);
  const rows = [...owner.gpuMaterials.entries()];
  if (rows.length !== quad.emitters.length || !rows.length)
    throw Error("Every prepared source material must be exercised");
  writeReplayCameraBlocks(
    [...owner.cameraBlocks],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1],
  );
  const columns = 9,
    rowCount = Math.ceil(rows.length / columns);
  rows.forEach(([key, { material, prepared }], index) => {
    const x = index % columns,
      y = Math.floor(index / columns),
      left = -1 + ((x + 0.12) * 2) / columns,
      right = -1 + ((x + 0.88) * 2) / columns,
      top = 1 - ((y + 0.12) * 2) / rowCount,
      bottom = 1 - ((y + 0.88) * 2) / rowCount,
      geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "a_POSITION",
      new THREE.BufferAttribute(
        new Float32Array([
          left,
          bottom,
          0,
          right,
          bottom,
          0,
          right,
          top,
          0,
          left,
          top,
          0,
        ]),
        3,
      ),
    );
    geometry.setAttribute(
      "a_COLOR",
      new THREE.BufferAttribute(new Uint8Array(16).fill(255), 4, true),
    );
    geometry.setAttribute(
      "a_TEXCOORD",
      new THREE.Float16BufferAttribute(
        new Uint16Array([
          0, 0, 0, 0, 15360, 0, 15360, 0, 15360, 15360, 15360, 15360, 0, 15360,
          0, 15360,
        ]),
        4,
      ),
    );
    geometry.setAttribute(
      "a_TEXCOORD1",
      new THREE.Float16BufferAttribute(
        new Uint16Array([0, 0, 15360, 0, 15360, 15360, 0, 15360]),
        2,
      ),
    );
    geometry.setIndex(
      new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = prepared.suppliedSortPass;
    scene.add(mesh);
    const label = document.createElement("li");
    label.textContent = `${index + 1}. ${key}`;
    labels.append(label);
  });
  gpu.render(scene, new THREE.Camera());
  gl.finish();
  const pixels = new Uint8Array(1080 * 600 * 4);
  gl.readPixels(0, 0, 1080, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  if (shaderErrors.length || error !== gl.NO_ERROR)
    throw Error(JSON.stringify({ shaderErrors, error }));
  const hash = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  window.componentControl = {
    state: "complete",
    materials: rows.length,
    drawCalls: gpu.info.render.calls,
    triangles: gpu.info.render.triangles,
    pixelSha256: hash,
    shaderErrors,
    effectSimulationAdmissionEstablished: false,
    actualMatchCoverageEstablished: false,
    suppliedGeometry:
      "explicit unit quads with white vertex color and identity camera",
  };
  status.textContent = `${rows.length} source materials submitted in ${gpu.info.render.calls} WebGL draws. Replay simulation admission is separate.`;
  window.addEventListener(
    "pagehide",
    () => {
      for (const child of scene.children) child.geometry?.dispose();
      owner.dispose();
      gpu.dispose();
    },
    { once: true },
  );
} catch (error) {
  window.componentControl = {
    state: "failed",
    error: String(error.stack ?? error),
  };
  status.textContent = window.componentControl.error;
  console.error(error);
}
