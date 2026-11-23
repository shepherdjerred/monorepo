import { fileURLToPath } from "node:url";
import {
  defineConfig,
  loadConfigFromFile,
  mergeConfig,
  normalizePath,
} from "vite";
import { recordedBuildDirectory } from "./recorded-build-directory.ts";

const productionLoader = normalizePath(
  fileURLToPath(new URL("../../../replay/src/resources.ts", import.meta.url)),
);
const recordedSchema = normalizePath(
  fileURLToPath(new URL("recorded-manifest.ts", import.meta.url)),
);
const manifestModule = "@scout-for-lol/domain/artifacts/replay-support.ts";

export default defineConfig(async (env) => {
  const appConfig = await loadConfigFromFile(
    env,
    fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
  );
  if (appConfig === null)
    throw new Error("Missing Scout app Vite configuration.");
  return mergeConfig(appConfig.config, {
    build: {
      outDir: recordedBuildDirectory(),
    },
    plugins: [
      {
        name: "scout-recorded-replay-manifest",
        enforce: "pre",
        resolveId(source: string, importer: string | undefined) {
          return source === manifestModule && importer === productionLoader
            ? recordedSchema
            : null;
        },
      },
    ],
  });
});
