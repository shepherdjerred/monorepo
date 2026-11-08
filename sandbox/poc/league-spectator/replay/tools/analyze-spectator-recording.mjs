import { resolve } from "node:path";
import { analyzeLatestSpectatorRecording } from "../latest-spectator-recording-analysis.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun analyze-spectator-recording.mjs <browser-recording.json> <analysis.json>",
  );
const input = resolve(inputArg),
  output = resolve(outputArg),
  inputs = {};
if (input === output)
  throw Error("Analysis must preserve original browser recording bytes");
const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = hash(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Recording analysis input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
if (Bun.file(input).size > 128 * 1024 * 1024)
  throw Error("Browser recording exceeds analysis capacity");
const bytes = await raw(input);
if (bytes.length > 128 * 1024 * 1024)
  throw Error("Browser recording exceeds analysis capacity");
const result = analyzeLatestSpectatorRecording(
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
);
if (Object.hasOwn(inputs, output))
  throw Error("Analysis cannot overwrite its source input");
for (const [path, expected] of Object.entries(inputs))
  if (hash(await Bun.file(path).bytes()) !== expected)
    throw Error(
      "Recording analysis source changed before publication: " + path,
    );
await Bun.write(output, JSON.stringify({ ...result, inputs }, null, 2));
console.log(
  JSON.stringify({
    output,
    measurements: Object.fromEntries(
      Object.entries(result.measurements).map(([name, row]) => [
        name,
        {
          samples: row.samples,
          completeContinuousWindowObserved:
            row.completeContinuousWindowObserved,
          averageDisplayFps: row.averageDisplayFps,
          simulationAndGeometryP95Ms: row.simulationAndGeometryP95Ms,
          simulationAndGeometryBudgetMet: row.simulationAndGeometryBudgetMet,
          clockDiscontinuities: row.clockDiscontinuities.length,
        },
      ]),
    ),
    observations: result.observations,
    scope: result.scope,
  }),
);
