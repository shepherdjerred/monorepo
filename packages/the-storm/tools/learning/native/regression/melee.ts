import path from "node:path";
import { diagnosticPaths } from "#learning/native/diagnostics/options.ts";
import {
  regressionEvidence,
  verifyOwned,
} from "#learning/native/regression/files.ts";
import {
  captureRegression,
  drained,
  waitForPhase,
  type Capture,
} from "./capture.ts";
import { openNativeConsole } from "./console.ts";
import { liveOpponents } from "./roster.ts";
import { MeleeIdentity, meleeRequests, nativeMelee } from "./melee-gate.ts";
import { MeleeProbe } from "./melee-wire.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const { model, output } = diagnosticPaths();
const ownership = { created: false };

async function scenario(capture: Capture) {
  ownership.created = true;
  const { fixture, save } = capture;
  const native = await openNativeConsole(capture, output);
  await native("showcase", "rwf admin showcase 16");
  let state = await waitForPhase(
    fixture,
    "LIVE",
    Date.now() + 30_000,
    "Original melee live roster missing",
  );
  const { first, attacker, victim } = liveOpponents(state, "trooper");
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
  const { file: recording, ...evidence } = await regressionEvidence(
    output,
    identity.match,
  );
  const { measured, melee } = nativeMelee({
    ...evidence,
    identity,
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

await verifyOwned(output, ownership, verify);
console.warn(
  `Verified native LOS rejection and direct/applied-Java knockback: ${output}`,
);
