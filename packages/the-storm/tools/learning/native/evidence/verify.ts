import type { Snapshot } from "#learning/promotion/archive.ts";
import path from "node:path";
import { root } from "#learning/sandbox.ts";
import { RegressionEvidence } from "#learning/promotion/contract.ts";
import { nativeFingerprint } from "#learning/preference/eligibility.ts";
import { simulationFloors } from "#learning/native/simulation/replay.ts";
import { Inputs, Suite, cases, type Case } from "./wire.ts";
import { equal, freezeInputs, originalCase } from "./files.ts";
import { replayNative } from "./native.ts";
import { z } from "zod";

export const measurementsFile = (suiteFile: string) =>
  path.join(path.dirname(suiteFile), "measured-regressions.json");

export async function replayCases(
  snapshot: Snapshot,
  rawInputs: unknown,
  bindings: Case[],
) {
  const inputs = Inputs.parse(rawInputs);
  equal(
    bindings.map((row) => row.name),
    cases.map((row) => row.name),
    "Original regression case inventory differs",
  );
  if (new Set(bindings.map((row) => row.directory)).size !== cases.length)
    throw new Error("Original regression cases reused an owned directory");
  await freezeInputs(snapshot, inputs);
  let nativeFloors: unknown, simulation: unknown;
  for (const [index, binding] of bindings.entries()) {
    const entry = cases[index];
    if (entry === undefined) throw new Error("Original case inventory missing");
    const original = await originalCase(
      snapshot,
      binding,
      entry.kind,
      entry.name === "simulation-floors"
        ? { capture: inputs.capture, simulation: inputs.simulation }
        : inputs.capture,
    );
    if (entry.name === "simulation-floors") {
      const measured = simulationFloors(
        await original.text(
          "simulation.jsonl",
          original.digest("journal_sha256"),
        ),
      );
      equal(
        measured,
        original.receipt["measured"],
        "Simulation receipt differs from original replay",
      );
      simulation = measured.floors;
    } else {
      const result = await replayNative(entry.name, original);
      const measured = result.measured;
      const declarations = {
        match: measured.match,
        rows: measured.sequence,
        controls: measured.counts,
        ages: measured.appliedAges,
        batchRows: measured.batchRows,
        after: measured.after,
      };
      for (const [key, value] of Object.entries(declarations))
        equal(
          value,
          original.receipt[key],
          `Native receipt differs from original replay: ${key}`,
        );
      if ("movement" in result) nativeFloors = result.movement.nativeFloors;
    }
  }
  await freezeInputs(snapshot, inputs);
  await snapshot.verify();
  return RegressionEvidence.parse({
    schema: 1,
    kind: "rwf-actor-regressions",
    acceptance: "unaccepted",
    actor_sha256: inputs.capture.artifacts.actor,
    native_sha256: nativeFingerprint(inputs.capture.native),
    cases: cases.map((row) => ({
      name: row.name,
      checks: 1,
      failures: 0,
      skipped: 0,
    })),
    native_floors: nativeFloors,
    simulation_floors: simulation,
  });
}

/** Promotion replays the full original inventory before archiving any pass claim. */
export async function originalSuite(
  snapshot: Snapshot,
  file: string,
  candidate: {
    actor_sha256: string;
    native_sha256: string;
    source_manifest_sha256: string;
  },
) {
  const suite = Suite.parse(await snapshot.json(file));
  for (const binding of suite.cases)
    if (
      binding.directory !==
      path.join(path.dirname(path.resolve(file)), binding.name)
    )
      throw new Error(
        "Regression suite borrowed a case from another owned attempt",
      );
  const declared = await snapshot.json(
    path.join(path.dirname(file), "inputs.json"),
  );
  const inputDeclaration = z
    .strictObject({
      schema: z.literal(1),
      acceptance: z.literal("unaccepted"),
      diagnostic: z.literal(true),
      retries: z.literal(0),
      inputs: Inputs,
    })
    .parse(declared);
  equal(
    inputDeclaration.inputs,
    suite.inputs,
    "Original suite input declaration changed",
  );
  for (const name of ["wire.ts", "files.ts", "native.ts", "verify.ts"])
    await snapshot.add(path.join(root, "tools/learning/native/evidence", name));
  if (
    suite.inputs.capture.artifacts.actor !== candidate.actor_sha256 ||
    suite.inputs.capture.artifacts.manifest !==
      candidate.source_manifest_sha256 ||
    nativeFingerprint(suite.inputs.capture.native) !== candidate.native_sha256
  )
    throw new Error(
      "Original regression suite differs from candidate actor, manifest or native runtime",
    );
  const measured = await replayCases(snapshot, suite.inputs, suite.cases);
  equal(
    measured,
    suite.measured,
    "Regression suite claims differ from original replay",
  );
  const aggregate = measurementsFile(file);
  await snapshot.add(aggregate, suite.measured_sha256);
  equal(
    await snapshot.json(aggregate),
    measured,
    "Java regression aggregates differ from original replay",
  );
  return measured;
}
