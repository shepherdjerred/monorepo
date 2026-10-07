import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { captureRegression, drained, type Capture } from "./capture.ts";
import { openNativeConsole } from "./console.ts";
import { MeleeIdentity, meleeRequests, nativeMelee } from "./melee-gate.ts";
import { MeleeProbe } from "./melee-wire.ts";
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
  const { fixture, save } = capture;
  const native = await openNativeConsole(capture, output);
  await native("showcase", "rwf admin showcase 16");
  let state = await fixture.command("sample");
  const deadline = Date.now() + 30_000;
  while (state.phase !== "LIVE") {
    if (Date.now() >= deadline)
      throw new Error("Original melee live roster missing");
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  const first = state.transitions.find((row) => row.phase === "LIVE");
  const attacker = first?.fighters.find(
    (row) => row.bot && row.alive && row.kit === "trooper",
  );
  const victim = first?.fighters.find(
    (row) =>
      row.bot &&
      row.alive &&
      row.kit === "trooper" &&
      row.team !== attacker?.team,
  );
  if (first === undefined || attacker === undefined || victim === undefined)
    throw new Error("Original draft lacks opposing melee Troopers");
  const identity = MeleeIdentity.parse({
    schema: 1,
    source: "automated-regression-console",
    humanDemonstration: false,
    match: first.match,
    attacker: attacker.body,
    victim: victim.body,
  });
  await save("melee.json", identity);
  const requests = meleeRequests(identity);
  for (const [key, command] of requests.slice(1, 4)) {
    const row = await native(key, command);
    if (["blocked", "clear"].includes(key))
      MeleeProbe.parse(JSON.parse(row.response.trim()));
  }
  const ending = Date.now() + 16 * 60_000;
  state = await fixture.command("sample");
  while (state.result !== "ended" || !drained(state)) {
    if (state.result === "stopped" || Date.now() >= ending)
      throw new Error("Original melee normal ending missing");
    await Bun.sleep(250);
    state = await fixture.command("sample");
  }
  for (const [key, command] of requests.slice(4)) await native(key, command);
}

async function readLines(name: string): Promise<unknown[]> {
  const text = await Bun.file(path.join(output, name)).text();
  return text
    .trim()
    .split("\n")
    .map((row): unknown => JSON.parse(row));
}

async function verify() {
  const { inputs } = await captureRegression(
    {
      model,
      output,
      caseName: "native-los-and-knockback",
      bots: 16,
      profile: "regression",
    },
    scenario,
  );
  const identity = MeleeIdentity.parse(
    await Bun.file(path.join(output, "melee.json")).json(),
  );
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${identity.match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original melee recording missing or duplicated");
  const recording = path.join(output, "recordings", originals[0]);
  const { measured, melee } = nativeMelee({
    commands: await readLines("commands.jsonl"),
    native: await readLines("native-commands.jsonl"),
    identity,
    recording: gunzipSync(await Bun.file(recording).arrayBuffer()).toString(
      "utf8",
    ),
  });
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-los-knockback-diagnostic",
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
      melee,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      native_commands_sha256: await digestFile(
        path.join(output, "native-commands.jsonl"),
      ),
      melee_sha256: await digestFile(path.join(output, "melee.json")),
      original_recording: {
        file: recording,
        sha256: await digestFile(recording),
      },
      source: "automated-regression-console",
      humanDemonstration: false,
      allRegressionCasesMeasured: false,
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
  `Verified native LOS rejection and direct/applied-Java knockback: ${output}`,
);
