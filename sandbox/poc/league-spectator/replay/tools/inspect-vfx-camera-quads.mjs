import { createLatestVfxCameraQuads } from "../latest-vfx-camera-quads.mjs";
import { inspectPreparedQuadPackage } from "./inspect-prepared-quad-package.mjs";

await inspectPreparedQuadPackage({
  argv: process.argv.slice(2),
  inspectorPath: import.meta.path,
  metadataFile: "vfx-camera-quads.json",
  observerFile: "observe-vfx-camera-quads.py",
  createRuntime: createLatestVfxCameraQuads,
  cameraCache: true,
  sourceFiles: [
    "latest-vfx-camera-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "native-decoder.mjs",
    "tools/inspect-prepared-quad-package.mjs",
  ],
});
