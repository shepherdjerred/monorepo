import { createLatestVfxBoundQuads } from "../latest-vfx-bound-quads.mjs";
import { inspectPreparedQuadPackage } from "./inspect-prepared-quad-package.mjs";

let markerUnmapped = false;
async function createRuntime(...args) {
  const runtime = await createLatestVfxBoundQuads(...args);
  try {
    try {
      runtime.kernel.read(0x20000000, 1);
    } catch (error) {
      if (!String(error).includes("UC_ERR_READ_UNMAPPED")) throw error;
      markerUnmapped = true;
    }
    if (!markerUnmapped) throw Error("Texture-presence marker is readable");
    return runtime;
  } catch (error) {
    runtime.close();
    throw error;
  }
}

await inspectPreparedQuadPackage({
  argv: process.argv.slice(2),
  inspectorPath: import.meta.path,
  metadataFile: "vfx-bound-quads.json",
  observerFile: "observe-vfx-bound-quads.py",
  createRuntime,
  cameraCache: true,
  sourceFiles: [
    "latest-vfx-bound-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "native-decoder.mjs",
    "tools/inspect-prepared-quad-package.mjs",
  ],
});
const proof = await Bun.file(process.argv[4]).json();
proof.texturePresenceMarkerUnmapped = markerUnmapped;
await Bun.write(process.argv[4], JSON.stringify(proof, null, 2));
