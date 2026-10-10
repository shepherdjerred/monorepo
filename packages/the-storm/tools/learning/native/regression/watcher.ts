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
import {
  WatcherIdentity,
  watcherRequests,
  spectatorImmunity,
} from "./watcher-gate.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const { model, output } = diagnosticPaths();
const ownership = { created: false };

async function scenario(capture: Capture) {
  ownership.created = true;
  const { fixture, paper, cleanup, save } = capture;
  const native = await openNativeConsole(capture, output);
  const watcher = await connectBot({
    ...paper.playerAddress,
    username: "RwfSpectator",
  });
  cleanup.push(async () => disconnectBot(watcher));
  const messages: string[] = [];
  watcher.on("messagestr", (message: string) => {
    messages.push(message);
  });
  cleanup.push(async () =>
    save("watcher-transcript.json", {
      source: "automated-regression-client",
      messages,
    }),
  );
  watcher.chat("/rwf spectate");
  const deadline = Date.now() + 30_000;
  while (watcher.game.gameMode !== "spectator") {
    if (Date.now() >= deadline)
      throw new Error("Original spectator mode missing");
    await fixture.command("sample");
    await Bun.sleep(100);
  }
  await native("showcase", "rwf admin showcase 16");
  let state = await waitForPhase(
    fixture,
    "LIVE",
    deadline,
    "Original spectator showcase did not start",
  );
  const { first, attacker, victim } = liveOpponents(state, "any");
  const identity = WatcherIdentity.parse({
    schema: 1,
    source: "automated-regression-client",
    command: "/rwf spectate",
    humanDemonstration: false,
    match: first.match,
    watcher: watcher.player.uuid,
    name: watcher.username,
    attacker: attacker.body,
    victim: victim.body,
  });
  await save("watcher.json", identity);
  const requests = watcherRequests(identity);
  for (const [key, command] of requests.slice(1, 15))
    await native(key, command);
  const endDeadline = Date.now() + 16 * 60_000;
  state = await fixture.command("sample");
  while (state.result !== "ended" || !drained(state)) {
    if (state.result === "stopped" || Date.now() >= endDeadline)
      throw new Error("Spectator showcase lacks an original normal ending");
    await Bun.sleep(250);
    state = await fixture.command("sample");
  }
  for (const [key, command] of requests.slice(15)) await native(key, command);
}

async function verify() {
  const { inputs } = await captureRegression(
    {
      model,
      output,
      caseName: "spectator-immunity",
      bots: 16,
      profile: "regression",
    },
    scenario,
  );
  const identity = WatcherIdentity.parse(
    await Bun.file(path.join(output, "watcher.json")).json(),
  );
  const { file: recording, ...evidence } = await regressionEvidence(
    output,
    identity.match,
  );
  const { measured, spectator } = spectatorImmunity({
    ...evidence,
    identity,
  });
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-spectator-immunity-diagnostic",
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
      spectator,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      native_commands_sha256: await digestFile(
        path.join(output, "native-commands.jsonl"),
      ),
      watcher_sha256: await digestFile(path.join(output, "watcher.json")),
      original_recording: {
        file: recording,
        sha256: await digestFile(recording),
      },
      source: "automated-regression-client",
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
  `Verified native spectator immunity and positive fighter damage: ${output}`,
);
