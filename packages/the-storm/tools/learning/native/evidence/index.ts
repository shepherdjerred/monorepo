import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { root } from "#learning/sandbox.ts";
import { buildCaptureInputs, captureInputs } from "#learning/native/inputs.ts";
import {
  simulationGradle,
  simulationInputs,
} from "#learning/native/simulation/inputs.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";
import { Snapshot } from "#learning/promotion/archive.ts";
import { Inputs, Suite, cases, type Case } from "./wire.ts";
import { replayCases } from "./verify.ts";
import { equal } from "./files.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700, recursive: false });
const save = (name: string, value: unknown) =>
  seal(path.join(output, name), jsonText(value));
async function currentInputs() {
  const simulation = await simulationInputs();
  return Inputs.parse({
    capture: await captureInputs(model),
    simulation,
    simulation_classpath: {
      file: path.join(
        root,
        "plugin/modules/rwfbots/build/simulation-classpath.json",
      ),
      sha256: simulation.classpath_sha256,
    },
  });
}
try {
  await buildCaptureInputs();
  await simulationGradle(
    [":rwfbots:simulationCaptureInputs"],
    path.join(output, "build.log"),
  );
  const inputs = await currentInputs();
  await save("inputs.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs,
  });
  const bindings: Case[] = [];
  for (const entry of cases) {
    equal(
      await currentInputs(),
      inputs,
      "Frozen regression suite inputs changed before case",
    );
    const directory = path.join(output, entry.name);
    console.warn(`Original regression case: ${entry.name}`);
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(root, "tools/learning/native", entry.script),
        "--model",
        model,
        "--output",
        directory,
      ],
      {
        stdout: Bun.file(path.join(output, `${entry.name}.log`)),
        stderr: "inherit",
      },
    );
    if ((await child.exited) !== 0)
      throw new Error(
        `Original regression case failed; no retry: ${entry.name}`,
      );
    equal(
      await currentInputs(),
      inputs,
      "Frozen regression suite inputs changed after case",
    );
    bindings.push({
      name: entry.name,
      directory,
      receipt_sha256: await digestFile(
        path.join(directory, "verification.json"),
      ),
    });
    await save(`case-${bindings.length.toString()}.json`, bindings.at(-1));
  }
  const snapshot = new Snapshot();
  const measured = await replayCases(snapshot, inputs, bindings);
  await save("measured-regressions.json", measured);
  const measuredSha = await digestFile(
    path.join(output, "measured-regressions.json"),
  );
  await save(
    "regressions.json",
    Suite.parse({
      schema: 1,
      kind: "rwf-original-regression-suite",
      acceptance: "unaccepted",
      diagnostic: true,
      retries: 0,
      inputs,
      cases: bindings,
      measured,
      measured_sha256: measuredSha,
      modelAccepted: false,
      humanTrainingPerformed: false,
      rolloutEnabled: false,
    }),
  );
  await save("original-files.json", { schema: 1, files: snapshot.files() });
  equal(
    await currentInputs(),
    inputs,
    "Frozen regression suite inputs changed during replay",
  );
  await snapshot.verify();
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
console.warn(`Replayed all seven original regression cases: ${output}`);
