import { reconstructLatest } from "../latest-reconstruction.mjs";
import { restoreLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
self.onmessage = async ({ data }) => {
  try {
    const selected = await restoreLatestStaticCatalogSelection({
      initialization: data.initialization,
      load: async (path) => {
        if (!Object.hasOwn(data.staticAssets, path))
          throw Error("Missing captured reconstruction input: " + path);
        return data.staticAssets[path];
      },
    });
    const { default: createUnicorn } = await import(data.runtimeModuleUrl),
      { decompress } = await import(data.decompressModuleUrl),
      started = performance.now();
    const report = await reconstructLatest({
      ...data.inputs,
      staticCatalog: selected,
      uc: await createUnicorn(),
      decompress,
    });
    self.postMessage({
      ok: true,
      report,
      catalog: selected.describe(),
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: { name: error.name, message: error.message },
    });
  }
};
