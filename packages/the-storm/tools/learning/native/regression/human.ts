import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { Bot } from "mineflayer";
import type { RegressionClient } from "#learning/native/regression-client.ts";
import { captureRegression } from "./capture.ts";
import { humanCombat, humanRecording } from "./human-gate.ts";
import { joinTrooper } from "./player.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const ownership = { created: false };
async function verify() {
  const { measured, inputs } = await captureRegression(
    {
      model,
      output,
      caseName: "human-combat",
      bots: 7,
      profile: "regression-player",
    },
    async (capture) => {
      ownership.created = true;
      const { player } = await joinTrooper(capture);
      await offerUntilHit(capture.fixture, player);
    },
  );
  const combat = humanCombat(measured);
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${measured.match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original human recording missing or duplicated");
  const recording = path.join(output, "recordings", originals[0]);
  humanRecording(
    gunzipSync(await Bun.file(recording).arrayBuffer()).toString("utf8"),
    measured.match,
  );
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-human-combat-diagnostic",
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
      combat,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      original_recording: {
        file: recording,
        sha256: await digestFile(recording),
      },
      source: "automated-regression-client",
      recordingInputSource: "MISSING",
      allRegressionCasesMeasured: false,
      modelAccepted: false,
      humanTrainingPerformed: false,
      rolloutEnabled: false,
    }),
  );
}

async function offerUntilHit(fixture: RegressionClient, player: Bot) {
  const deadline = Date.now() + 60_000;
  let state = await fixture.command("sample");
  let appliedHit = false;
  const attacks = new Set<string>();
  while (!appliedHit && state.phase === "LIVE") {
    const alive = state.transitions
      .at(-1)
      ?.fighters.find((row) => row.body === player.player.uuid)?.alive;
    if (alive === false) break;
    if (Date.now() >= deadline)
      throw new Error("Java Trooper did not damage the joined player");
    state = await fixture.command("offer");
    for (const row of state.actions) {
      if (
        row.decision === "applied" &&
        row.targetBody === player.player.uuid &&
        row.ticket?.action.attack === true
      )
        attacks.add(`${row.body}/${row.serverTick.toString()}`);
    }
    appliedHit = state.damage.some(
      (row) =>
        row.victim === player.player.uuid &&
        row.before > row.after &&
        attacks.has(`${row.attacker}/${row.serverTick.toString()}`),
    );
    await Bun.sleep(250);
  }
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
  `Verified native damage to the joined regression player: ${output}`,
);
