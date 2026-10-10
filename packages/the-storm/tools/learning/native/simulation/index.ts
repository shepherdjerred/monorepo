import { mkdir } from "node:fs/promises";
import path from "node:path";
import { diagnosticPaths } from "#learning/native/diagnostics/options.ts";
import { simulationGradle, simulationInputs } from "./inputs.ts";
import { simulationFloors } from "./replay.ts";
import { buildCaptureInputs, captureInputs } from "#learning/native/inputs.ts";
import { jsonText, seal, digestFile } from "#learning/preference/ledger.ts";

const { model, output } = diagnosticPaths();
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const save = (file: string, value: unknown) =>
  seal(path.join(output, file), jsonText(value));
try {
  await buildCaptureInputs();
  await simulationGradle(
    [":rwfbots:simulationCaptureInputs"],
    path.join(output, "build.log"),
  );
  const inputs = {
    capture: await captureInputs(model),
    simulation: await simulationInputs(),
  };
  await save("inputs.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs,
  });
  const journal = path.join(output, "simulation.jsonl");
  await simulationGradle(
    [":rwfbots:simulationCapture", `-PsimulationCaptureFile=${journal}`],
    path.join(output, "capture.log"),
  );
  const current = {
    capture: await captureInputs(model),
    simulation: await simulationInputs(),
  };
  if (JSON.stringify(current) !== JSON.stringify(inputs))
    throw new Error(
      "Simulation actor, runtime, source or original producer inputs changed",
    );
  const measured = simulationFloors(await Bun.file(journal).text());
  await save("verification.json", {
    schema: 1,
    kind: "rwf-authored-simulation-floor-diagnostic",
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    source: "authored-simulation",
    humanDemonstration: false,
    trainingData: false,
    inputs,
    measured,
    journal_sha256: await digestFile(journal),
    allRegressionCasesMeasured: false,
    modelAccepted: false,
    humanTrainingPerformed: false,
    rolloutEnabled: false,
  });
} catch (error) {
  await save("failure.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
console.warn(
  `Verified all fixed original authored simulation floors: ${output}`,
);
