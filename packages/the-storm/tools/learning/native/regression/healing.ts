import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { captureRegression, type Capture } from "./capture.ts";
import { openNativeConsole } from "./console.ts";
import {
  HealingIdentity,
  HealingPersonality,
  healingRoster,
  healingRequests,
  healingLifecycle,
} from "./healing-gate.ts";
import { root } from "#learning/sandbox.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";
import type { RegressionSample } from "#learning/native/regression-client.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const ownership = { created: false };

async function originalPersonalities(ids: string[]) {
  const rows = [];
  for (const id of ids) {
    const safeId = HealingPersonality.shape.id.parse(id);
    const file = path.join(
      root,
      "server/owned/plugins/TheStorm/rwfbots/personalities",
      `${safeId}.yml`,
    );
    const content = z
      .object({
        id: z.literal(safeId),
        name: HealingPersonality.shape.name,
        quirks: HealingPersonality.shape.quirks,
      })
      .parse(Bun.YAML.parse(await Bun.file(file).text()));
    rows.push(
      HealingPersonality.parse({ ...content, sha256: await digestFile(file) }),
    );
  }
  return rows;
}

async function wait(
  capture: Capture,
  accepts: (state: RegressionSample) => boolean,
  timeout: number,
) {
  const deadline = Date.now() + timeout;
  let state = await capture.fixture.command("sample");
  while (!accepts(state)) {
    if (
      Date.now() >= deadline ||
      (["ended", "stopped"].includes(state.result) &&
        state.phase !== "RESETTING")
    )
      throw new Error(
        "Original healing checkpoint missing before its deadline",
      );
    await Bun.sleep(100);
    state = await capture.fixture.command("sample");
  }
  return state;
}

async function scenario(capture: Capture) {
  ownership.created = true;
  const { fixture, paper, save } = capture;
  const native = await openNativeConsole(capture, output);
  await native("showcase", "rwf admin showcase 16");
  const state = await wait(
    capture,
    (sample) => sample.phase === "LIVE",
    30_000,
  );
  const first = state.transitions.find((row) => row.phase === "LIVE");
  if (first === undefined)
    throw new Error("Original healing live roster missing");
  const personalities = await originalPersonalities(
    first.fighters.map((row) => row.personality),
  );
  const { healer, bodies } = healingRoster(first.fighters, personalities);
  const identity = HealingIdentity.parse({
    schema: 1,
    source: "automated-regression-console",
    humanDemonstration: false,
    match: first.match,
    healer: healer.body,
    personalities,
  });
  await save("healing.json", identity);
  const requests = healingRequests(healer.body, bodies);
  for (const [key, command] of requests.slice(1, 25))
    await native(key, command);
  await wait(
    capture,
    (sample) =>
      sample.actions.some(
        (row) => row.body === healer.body && row.absorption > 0,
      ),
    15_000,
  );
  for (const [key, command] of requests.slice(25, 28))
    await native(key, command);
  await wait(
    capture,
    (sample) => sample.actions.some((row) => row.decision === "applied"),
    60_000,
  );
  await fixture.command("finish");
  await wait(capture, (sample) => sample.phase === "LOBBY", 15_000);
  for (const [key, command] of requests.slice(28)) await native(key, command);
  await paper.exportRegressionNpcSave(path.join(output, "npc-save"));
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
      caseName: "healing-and-lifecycle",
      bots: 16,
      profile: "regression",
    },
    scenario,
  );
  const identity = HealingIdentity.parse(
    await Bun.file(path.join(output, "healing.json")).json(),
  );
  if (
    JSON.stringify(
      await originalPersonalities(identity.personalities.map((row) => row.id)),
    ) !== JSON.stringify(identity.personalities)
  )
    throw new Error(
      "Original healing habits differ from frozen personality content",
    );
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${identity.match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original healing recording missing or duplicated");
  const recording = path.join(output, "recordings", originals[0]);
  const npcSave = path.join(output, "npc-save/citizens-saves.yml");
  const { measured, healing } = healingLifecycle({
    commands: await readLines("commands.jsonl"),
    native: await readLines("native-commands.jsonl"),
    identity,
    recording: gunzipSync(await Bun.file(recording).arrayBuffer()).toString(
      "utf8",
    ),
    npcSave: await Bun.file(npcSave).text(),
  });
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-healing-lifecycle-diagnostic",
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
      healing,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      native_commands_sha256: await digestFile(
        path.join(output, "native-commands.jsonl"),
      ),
      healing_sha256: await digestFile(path.join(output, "healing.json")),
      original_recording: {
        file: recording,
        sha256: await digestFile(recording),
      },
      original_npc_save: { file: npcSave, sha256: await digestFile(npcSave) },
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
  `Verified native healing, authored item use and NPC teardown: ${output}`,
);
