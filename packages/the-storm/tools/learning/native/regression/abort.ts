import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { captureRegression, type Capture } from "./capture.ts";
import { joinTrooper } from "./player.ts";
import { lastHumanAbort, AbortSettlement } from "./abort-gate.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const ownership = { created: false };

async function checkpoint({ paper, fixture }: Capture, ids: string[]) {
  const start = await fixture.command("sample");
  const probes = [];
  for (const id of ids) {
    const command = `execute if entity ${z.uuid().parse(id)}`;
    probes.push({ command, response: await paper.console.command(command) });
  }
  const end = await fixture.command("sample");
  if (start.phase !== end.phase)
    throw new Error("Original phase changed during body probes");
  return {
    startSequence: start.sequence,
    endSequence: end.sequence,
    phase: end.phase,
    probes,
  };
}

async function scenario(capture: Capture) {
  ownership.created = true;
  const { fixture, paper, save } = capture;
  const joined = await joinTrooper(capture);
  const first = joined.state.transitions.find((row) => row.phase === "LIVE");
  if (first === undefined)
    throw new Error("Original live abort roster missing");
  const ids = [
    joined.id,
    ...first.fighters
      .filter((row) => row.bot)
      .map((row) => row.body)
      .sort(),
  ];
  const live = await checkpoint(capture, ids);
  await save("live-boundary.json", live);
  const contactDeadline = Date.now() + 60_000;
  let state = await fixture.command("offer");
  while (!state.actions.some((row) => row.decision === "applied")) {
    if (state.phase !== "LIVE" || Date.now() >= contactDeadline)
      throw new Error(
        "Original abort case did not apply Java controls before disconnect",
      );
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  await joined.disconnect();
  const deadline = Date.now() + 15_000;
  state = await fixture.command("sample");
  while (state.phase !== "LOBBY") {
    if (Date.now() >= deadline)
      throw new Error("Last-human abort did not return to the lobby");
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  const departed = await checkpoint(capture, ids);
  await save("departed-boundary.json", departed);
  await save("boundary.json", {
    schema: 1,
    match: first.match,
    player: joined.id,
    live,
    departed,
    debug: await paper.console.command("rwfbots debug"),
  });
  const database = await paper.exportRegressionDatabase(
    path.join(output, "database"),
  );
  const settlement = await readSettlement(database, first.match);
  await save("settlement.json", {
    database,
    sha256: await digestFile(database),
    rows: settlement,
  });
}

async function readSettlement(database: string, id: string) {
  const match = z.uuid().parse(id);
  return AbortSettlement.parse({
    matches: await querySqlite(
      database,
      `SELECT id, winner, humans, bots, recording_file, recording_bytes, dropped_frames FROM rwf_match WHERE id = '${match}'`,
    ),
    players: await querySqlite(
      database,
      `SELECT player, result, credits_owed, payout_status, credits_paid FROM rwf_match_player WHERE match_id = '${match}' ORDER BY player`,
    ),
  });
}

async function verify() {
  const { inputs } = await captureRegression(
    {
      model,
      output,
      caseName: "last-human-abort",
      bots: 7,
      profile: "regression-player",
    },
    scenario,
  );
  const text = await Bun.file(path.join(output, "commands.jsonl")).text();
  const raw: unknown[] = text
    .trim()
    .split("\n")
    .map((row): unknown => JSON.parse(row));
  const boundary: unknown = await Bun.file(
    path.join(output, "boundary.json"),
  ).json();
  const settlement = z
    .strictObject({
      database: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      rows: AbortSettlement,
    })
    .parse(await Bun.file(path.join(output, "settlement.json")).json());
  if ((await digestFile(settlement.database)) !== settlement.sha256)
    throw new Error("Original abort database changed");
  const match = z.object({ match: z.uuid() }).parse(boundary).match;
  if (
    JSON.stringify(await readSettlement(settlement.database, match)) !==
      JSON.stringify(settlement.rows) ||
    (await digestFile(settlement.database)) !== settlement.sha256
  )
    throw new Error("Abort settlement differs from its original database");
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original abort recording missing or duplicated");
  const recording = path.join(output, "recordings", originals[0]);
  const { measured, abort } = lastHumanAbort({
    commands: raw,
    boundary,
    settlement: settlement.rows,
    log: await Bun.file(path.join(output, "server.log")).text(),
    recording: gunzipSync(await Bun.file(recording).arrayBuffer()).toString(
      "utf8",
    ),
  });
  await seal(
    path.join(output, "verification.json"),
    jsonText({
      schema: 1,
      kind: "rwf-native-last-human-abort-diagnostic",
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
      abort,
      commands_sha256: await digestFile(path.join(output, "commands.jsonl")),
      boundary_sha256: await digestFile(path.join(output, "boundary.json")),
      settlement_sha256: await digestFile(path.join(output, "settlement.json")),
      server_log_sha256: await digestFile(path.join(output, "server.log")),
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
  `Verified native last-human disconnect and unpaid teardown: ${output}`,
);
