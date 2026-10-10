import path from "node:path";
import { diagnosticPaths } from "#learning/native/diagnostics/options.ts";
import {
  regressionEvidence,
  verifyOwned,
} from "#learning/native/regression/files.ts";
import {
  captureRegression,
  drained,
  type Capture,
} from "./regression/capture.ts";
import { openNativeConsole } from "./regression/console.ts";
import { nativeTeam, teamRequests } from "./regression/team-gate.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const { model, output } = diagnosticPaths();
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
  const { file: recording, ...evidence } = await regressionEvidence(
    output,
    original.match,
  );
  const { measured, movement } = nativeTeam({
    ...evidence,
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

await verifyOwned(output, ownership, verify);
console.warn(
  `Verified original native team movement and unchanged floors: ${output}`,
);
