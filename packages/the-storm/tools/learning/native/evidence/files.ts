import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { Snapshot } from "#learning/promotion/archive.ts";
import { root } from "#learning/sandbox.ts";
import { Digest } from "#learning/preference/gate.ts";
import { File, type Inputs, type Case } from "./wire.ts";

export function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message);
}

/** Snapshot and replay selected originals only; server credentials are never part of the inventory. */
export class Originals {
  constructor(
    readonly snapshot: Snapshot,
    readonly directory: string,
    readonly receipt: Record<string, unknown>,
  ) {}
  async text(name: string, digest?: string) {
    const file = path.join(this.directory, name);
    await this.snapshot.add(file, digest);
    return Bun.file(file).text();
  }
  async json(name: string, digest?: string): Promise<unknown> {
    return JSON.parse(await this.text(name, digest));
  }
  digest(key: string) {
    return Digest.parse(this.receipt[key]);
  }
  async lines(name: string, key: string) {
    const text = await this.text(name, this.digest(key));
    if (!text.endsWith("\n") || text.includes("\r"))
      throw new Error("Original native command journal is truncated");
    return text
      .slice(0, -1)
      .split("\n")
      .map((line): unknown => JSON.parse(line));
  }
  async recording() {
    const declared = File.parse(this.receipt["original_recording"]);
    const base = path.join(this.directory, "recordings");
    const listing = await readdir(base, { recursive: true });
    const files = listing.filter((file) => file.endsWith(".rwfrec.gz"));
    if (
      files.length !== 1 ||
      files[0] === undefined ||
      path.resolve(declared.file) !== path.join(base, files[0])
    )
      throw new Error(
        "Regression needs its unique original recording inside the owned case",
      );
    await this.snapshot.add(declared.file, declared.sha256);
    return gunzipSync(await Bun.file(declared.file).arrayBuffer()).toString(
      "utf8",
    );
  }
}

export async function originalCase(
  snapshot: Snapshot,
  binding: Case,
  kind: string,
  inputs: unknown,
) {
  const file = path.join(binding.directory, "verification.json");
  await snapshot.add(file, binding.receipt_sha256);
  const receipt = z
    .object({
      schema: z.literal(1),
      kind: z.literal(kind),
      acceptance: z.literal("unaccepted"),
      diagnostic: z.literal(true),
      retries: z.literal(0),
      inputs: z.unknown(),
      modelAccepted: z.literal(false),
      humanTrainingPerformed: z.literal(false),
      rolloutEnabled: z.literal(false),
      allRegressionCasesMeasured: z.literal(false),
    })
    .loose()
    .parse(await snapshot.json(file));
  const joined = ["human-combat", "last-human-abort"].includes(binding.name);
  if (joined)
    z.object({
      source: z.literal("automated-regression-client"),
      recordingInputSource: z.literal("MISSING"),
    }).parse(receipt);
  else if (binding.name === "simulation-floors")
    z.object({
      source: z.literal("authored-simulation"),
      humanDemonstration: z.literal(false),
      trainingData: z.literal(false),
    }).parse(receipt);
  else
    z.object({
      source: z.literal(
        binding.name === "spectator-immunity"
          ? "automated-regression-client"
          : "automated-regression-console",
      ),
      humanDemonstration: z.literal(false),
    }).parse(receipt);
  equal(receipt.inputs, inputs, "Original case used different frozen inputs");
  const declared = z
    .strictObject({
      schema: z.literal(1),
      acceptance: z.literal("unaccepted"),
      diagnostic: z.literal(true),
      inputs: z.unknown(),
      retries: z.literal(0),
    })
    .parse(await snapshot.json(path.join(binding.directory, "inputs.json")));
  equal(
    declared.inputs,
    inputs,
    "Original case input declaration differs from its receipt",
  );
  if (await Bun.file(path.join(binding.directory, "failure.json")).exists())
    throw new Error(
      "Failed original regression attempts cannot pass collection",
    );
  return new Originals(snapshot, binding.directory, receipt);
}

async function runtimeInventory(
  file: string,
): Promise<{ file: string; kind: string }[]> {
  const status = await lstat(file).catch((error: unknown) => {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      return null;
    throw error;
  });
  const kind =
    status === null
      ? "absent"
      : status.isFile()
        ? "file"
        : status.isDirectory()
          ? "directory"
          : "invalid";
  if (kind === "invalid")
    throw new Error("Original simulation runtime contains a nonregular entry");
  const rows = [{ file, kind }];
  if (kind === "directory") {
    const children = await readdir(file);
    children.sort();
    for (const child of children)
      rows.push(...(await runtimeInventory(path.join(file, child))));
  }
  return rows;
}

/** Rehash all original runtime/source inputs and retain absent classpath directories as invariants. */
export async function freezeInputs(snapshot: Snapshot, inputs: Inputs) {
  const paths = inputs.simulation.classpath;
  if (new Set(paths).size !== paths.length)
    throw new Error("Original simulation classpath contains duplicates");
  const inventory = await Promise.all(
    paths.map((file) => runtimeInventory(file)),
  );
  const actual = inventory.flat();
  equal(
    actual,
    inputs.simulation.hashes.map(({ file, kind }) => ({ file, kind })),
    "Original simulation runtime inventory changed",
  );
  if (
    !inputs.simulation.hashes.some(
      (row) =>
        row.kind === "file" && row.file.endsWith("/SimulationCapture.class"),
    )
  )
    throw new Error(
      "Original simulation producer class missing from frozen runtime",
    );
  equal(
    inputs.simulation_classpath.sha256,
    inputs.simulation.classpath_sha256,
    "Simulation classpath declaration differs",
  );
  await snapshot.add(
    inputs.simulation_classpath.file,
    inputs.simulation_classpath.sha256,
  );
  equal(
    await snapshot.json(inputs.simulation_classpath.file),
    inputs.simulation.classpath,
    "Original Java classpath metadata changed",
  );
  for (const file of [
    ...inputs.capture.native.hashes,
    ...inputs.capture.renderer,
    ...inputs.simulation.sources,
  ])
    await snapshot.add(path.resolve(root, file.file), file.sha256);
  for (const row of inputs.simulation.hashes) {
    if ((row.kind === "file") !== (row.sha256 !== null))
      throw new Error(
        "Original simulation runtime entry changed kind or presence",
      );
    if (row.sha256 !== null) await snapshot.add(row.file, row.sha256);
  }
}
