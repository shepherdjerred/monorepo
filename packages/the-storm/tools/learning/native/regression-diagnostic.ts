import { mkdir, open, readdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  RegressionClient,
  type RegressionSample,
} from "./regression-client.ts";
import {
  regressionJournal,
  type RegressionCommand,
} from "./regression-gate.ts";
import { buildCaptureInputs, captureInputs } from "./inputs.ts";
import { openPaperDuels } from "#learning/sandbox.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";
import { readTrails, dispersion, advance } from "#e2e/harness/rwf-trails.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
await buildCaptureInputs();
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const save = (name: string, value: unknown) =>
  seal(path.join(output, name), jsonText(value));
const inputs = await captureInputs(model);
await save("inputs.json", {
  schema: 1,
  acceptance: "unaccepted",
  diagnostic: true,
  inputs,
  retries: 0,
});

function drained(state: RegressionSample): boolean {
  const metrics = state.inference;
  return (
    metrics !== null &&
    metrics.submitted === metrics.deadlineMet + metrics.deadlineMissed
  );
}

async function collect() {
  const paper = await openPaperDuels(output, model, "regression");
  let raw: FileHandle | undefined;
  const commands: RegressionCommand[] = [];
  try {
    raw = await open(path.join(output, "commands.jsonl"), "wx", 0o600);
    const writer = raw;
    const fixture = new RegressionClient(
      paper.console,
      async (command, state) => {
        await writer.write(JSON.stringify({ command, state }) + "\n");
        await writer.sync();
        commands.push({ command, state });
      },
    );
    await fixture.load();
    await fixture.command("arm native-team-advancement 16");
    const response = await paper.console.command("rwf admin showcase 16");
    await save("showcase-command.json", {
      command: "rwf admin showcase 16",
      response,
    });
    const deadline = Date.now() + 16 * 60_000;
    let state = await fixture.command("sample");
    while (!["ended", "stopped"].includes(state.result) || !drained(state)) {
      if (Date.now() >= deadline)
        throw new Error("Original native regression diagnostic did not finish");
      await Bun.sleep(250);
      state = await fixture.command("sample");
    }
    await fixture.command("release");
    return commands;
  } finally {
    try {
      await raw?.close();
    } finally {
      await paper.stop();
    }
  }
}

async function verify() {
  const commands = await collect();
  if (JSON.stringify(await captureInputs(model)) !== JSON.stringify(inputs))
    throw new Error("Native regression actor, environment or recorder changed");
  const measured = regressionJournal(commands, "native-team-advancement");
  if (measured.counts.applied === 0 || measured.damageEvents === 0)
    throw new Error(
      "Native diagnostic did not apply Java controls and measure actual damage",
    );
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${measured.match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error(
      "Native diagnostic original recording missing or duplicated",
    );
  const recording = path.join(output, "recordings", originals[0]);
  const rows = gunzipSync(await Bun.file(recording).arrayBuffer())
    .toString("utf8")
    .trim()
    .split("\n");
  const header = rows[0]?.split("\t");
  if (
    header?.[0] !== "H" ||
    header[1] !== "3" ||
    header[2] !== measured.match ||
    rows.filter((row) => row.startsWith("X\t")).length !== 1
  )
    throw new Error(
      "Native diagnostic original recording lacks its schema-3 match and terminal",
    );
  const trails = readTrails(rows);
  if (
    trails.mapId !== "training-yard" ||
    trails.roster.size !== 16 ||
    [...trails.roster.values()].some((member) => !member.bot) ||
    trails.firstContact === undefined
  )
    throw new Error("Native diagnostic original roster or contact differs");
  await save("verification.json", {
    schema: 1,
    kind: "rwf-native-authored-regression-diagnostic",
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs,
    match: measured.match,
    rows: measured.sequence,
    controls: measured.counts,
    ages: measured.appliedAges,
    batchRows: measured.batchRows,
    before: measured.before,
    after: measured.after,
    actualDamageEvents: measured.damageEvents,
    actualDamage: measured.damageAmount,
    commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
    original_recording: {
      file: recording,
      sha256: await digestFile(recording),
    },
    measuredAdvancement: {
      spacing: dispersion(trails, { from: 0, until: trails.firstContact }),
      at8: advance(trails, { at: 160, until: trails.firstContact }),
      atContact: advance(trails, {
        at: trails.firstContact,
        until: trails.firstContact,
      }),
      by10: advance(trails, { at: 200, until: 200 }),
    },
    allRegressionCasesMeasured: false,
    simulationFloorsMeasured: false,
    modelAccepted: false,
    humanTrainingPerformed: false,
    rolloutEnabled: false,
  });
}
try {
  await verify();
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
console.warn(`Verified original native regression journal: ${output}`);
