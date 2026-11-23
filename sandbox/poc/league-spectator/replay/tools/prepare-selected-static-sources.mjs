import { resolve } from "node:path";
import { publishSelectedStaticSources } from "./selected-static-sources.mjs";

const [configurationPath, outputCache] = process.argv.slice(2);
if (!configurationPath || !outputCache || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-selected-static-sources.mjs <private-source-configuration.json> <output-cache>",
  );
const configuration = await Bun.file(resolve(configurationPath)).json();
if (
  !configuration ||
  Object.keys(configuration).sort().join("|") !== "plan|roots"
)
  throw Error("Explicit {plan,roots} source configuration required");
const result = await publishSelectedStaticSources({
  ...configuration,
  outputCache: resolve(outputCache),
});
console.log(
  JSON.stringify({
    publicRoot: result.publicRoot,
    sources: Object.keys(result.receipt.sources),
    files: Object.keys(result.receipt.files).length,
    nativeSpectatorAdmitted: false,
  }),
);
