import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  captureRegression,
  drained,
  type Capture,
} from "./regression/capture.ts";
import { openNativeConsole } from "./regression/console.ts";
import { nativeTeam, teamRequests } from "./regression/team-gate.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const ownership = { created: false };

async function scenario(capture: Capture) {
  ownership.created = true;
  const native = await openNativeConsole(capture, output);
  const run = async (index: number) => {
    const request = teamRequests[index];
    if (request === undefined) throw new Error("Team native request missing");
    await native(request[0], request[1]);
  };
  await run(0);
  let state = await capture.fixture.command("sample");
  const deadline = Date.now() + 30_000;
  while (state.phase !== "LIVE") {
    if (Date.now() >= deadline)
      throw new Error("Original team live roster missing");
    await Bun.sleep(100);
    state = await capture.fixture.command("sample");
  }
  await run(1);
  const ending = Date.now() + 16 * 60_000;
  while (state.result !== "ended" || !drained(state)) {
    if (state.result === "stopped" || Date.now() >= ending)
      throw new Error("Original team normal ending missing");
    await Bun.sleep(250);
    state = await capture.fixture.command("sample");
  }
  await run(2);
}

async function readLines(name: string): Promise<unknown[]> {
  const text = await Bun.file(path.join(output, name)).text();
  return text
    .trim()
    .split("\n")
    .map((row): unknown => JSON.parse(row));
}

async function verify() {
  const { inputs, measured: original } = await captureRegression(
    {
      model,
      output,
      caseName: "native-team-advancement",
      bots: 16,
      profile: "regression",
    },
    scenario,
  );
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${original.match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original team recording missing or duplicated");
  const recording = path.join(output, "recordings", originals[0]);
  const { measured, movement } = nativeTeam({
    commands: await readLines("commands.jsonl"),
    native: await readLines("native-commands.jsonl"),
    recording: gunzipSync(await Bun.file(recording).arrayBuffer()).toString(
      "utf8",
    ),
  });
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-team-advancement-diagnostic",
      acceptance: "unaccepted",
      diagnostic: true,
      retries: 0,
      inputs,
      match: measured.match,
      rows: measured.sequence,
      controls: measured.counts,
      ages: measured.appliedAges,
      batchRows: measured.batchRows,
      after: measured.after,
      actualDamageEvents: measured.damageEvents,
      actualDamage: measured.damageAmount,
      movement,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      native_commands_sha256: await digestFile(
        path.join(output, "native-commands.jsonl"),
      ),
      original_recording: {
        file: recording,
        sha256: await digestFile(recording),
      },
      source: "automated-regression-console",
      humanDemonstration: false,
      allRegressionCasesMeasured: false,
      simulationFloorsMeasured: false,
      modelAccepted: false,
      humanTrainingPerformed: false,
      rolloutEnabled: false,
    }),
  );
}

try {
  await verify();
} catch (error) {
  if (
    ownership.created &&
    !(await Bun.file(path.join(output, "failure.json")).exists())
  )
    await seal(
      path.join(output, "failure.json"),
      jsonText({
        schema: 1,
        acceptance: "unaccepted",
        diagnostic: true,
        retries: 0,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  throw error;
}
console.warn(
  `Verified original native team movement and unchanged floors: ${output}`,
);
