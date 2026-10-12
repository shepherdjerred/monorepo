import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { root } from "#learning/sandbox.ts";
import { jsonText, digestFile } from "#learning/preference/ledger.ts";
import { Inputs, Suite, cases } from "#learning/native/evidence/wire.ts";
import { Snapshot } from "#learning/promotion/archive.ts";
import { replayCases } from "#learning/native/evidence/verify.ts";
import {
  humanJournal,
  abortJournal,
} from "#learning/native/evidence/test-support/player-fixture.ts";
import { watcherFixture } from "#learning/native/evidence/test-support/watcher-fixture.ts";
import { healingFixture } from "#learning/native/evidence/test-support/healing-fixture.ts";
import { meleeFixture } from "#learning/native/regression/melee-fixture.ts";
import { teamFixture } from "#learning/native/regression/team-fixture.ts";
import {
  simulationFixture,
  simulationText,
} from "#learning/native/simulation/fixture.ts";
import { simulationFloors } from "#learning/native/simulation/replay.ts";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";
import { humanCombat } from "#learning/native/regression/human-gate.ts";
import { lastHumanAbort } from "#learning/native/regression/abort-gate.ts";
import { spectatorImmunity } from "#learning/native/regression/watcher-gate.ts";
import {
  HealingIdentity,
  HealingPersonality,
  healingLifecycle,
} from "#learning/native/regression/healing-gate.ts";
import { nativeMelee } from "#learning/native/regression/melee-gate.ts";
import { nativeTeam } from "#learning/native/regression/team-gate.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";

type Entry = (typeof cases)[number];
type NativeEvidence = {
  commands: unknown;
  recording: string;
  native?: unknown;
};

async function file(
  directory: string,
  name: string,
  value: string | Uint8Array,
) {
  const target = path.join(directory, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
  return { file: target, sha256: await digestFile(target) };
}
async function json(directory: string, name: string, value: unknown) {
  return file(directory, name, jsonText(value));
}
async function jsonDigest(directory: string, name: string, value: unknown) {
  const saved = await json(directory, name, value);
  return saved.sha256;
}
async function textDigest(directory: string, name: string, value: string) {
  const saved = await file(directory, name, value);
  return saved.sha256;
}
const lines = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

async function nativeReceipt(
  options: { directory: string; entry: Entry; inputs: Inputs },
  evidence: NativeEvidence,
  details: Record<string, unknown>,
) {
  const { directory, entry, inputs } = options;
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, entry.name);
  const originalRecording = await file(
    directory,
    `recordings/rwf/${measured.match}.rwfrec.gz`,
    gzipSync(evidence.recording),
  );
  const commandsFile = await file(directory, "commands.jsonl", lines(commands));
  const native =
    evidence.native === undefined
      ? {}
      : {
          native_commands_sha256: await textDigest(
            directory,
            "native-commands.jsonl",
            lines(z.array(z.unknown()).parse(evidence.native)),
          ),
        };
  await json(directory, "inputs.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs: inputs.capture,
  });
  return json(directory, "verification.json", {
    schema: 1,
    kind: entry.kind,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs: inputs.capture,
    match: measured.match,
    rows: measured.sequence,
    controls: measured.counts,
    ages: measured.appliedAges,
    batchRows: measured.batchRows,
    after: measured.after,
    commands_sha256: commandsFile.sha256,
    ...native,
    original_recording: originalRecording,
    ...details,
    modelAccepted: false,
    humanTrainingPerformed: false,
    rolloutEnabled: false,
    allRegressionCasesMeasured: false,
    source: ["human-combat", "last-human-abort", "spectator-immunity"].includes(
      entry.name,
    )
      ? "automated-regression-client"
      : "automated-regression-console",
    ...(["human-combat", "last-human-abort"].includes(entry.name)
      ? { recordingInputSource: "MISSING" }
      : { humanDemonstration: false }),
  });
}

async function healedFixture() {
  const evidence = healingFixture();
  const directory = path.join(
    root,
    "server/owned/plugins/TheStorm/rwfbots/personalities",
  );
  const personalities = [];
  const listing = await readdir(directory);
  for (const name of listing.filter((item) => item.endsWith(".yml")).sort()) {
    const target = path.join(directory, name);
    const content = z
      .object({
        id: HealingPersonality.shape.id,
        name: HealingPersonality.shape.name,
        quirks: HealingPersonality.shape.quirks,
      })
      .parse(Bun.YAML.parse(await Bun.file(target).text()));
    personalities.push(
      HealingPersonality.parse({
        ...content,
        sha256: await digestFile(target),
      }),
    );
  }
  const eligible = personalities.find(
    (row) =>
      !row.quirks.some((quirk) =>
        ["never_eats", "gapple_hoarder"].includes(quirk),
      ),
  );
  if (eligible === undefined)
    throw new Error("Fixture requires authored eligible personality content");
  const ordered = [
    eligible,
    ...personalities.filter((row) => row.id !== eligible.id),
  ].slice(0, 16);
  let text = JSON.stringify(evidence.commands);
  for (const [index, row] of ordered.entries())
    text = text.replaceAll(
      `"personality":"boundary-${index.toString()}"`,
      `"personality":"${row.id}"`,
    );
  const commands = z.array(RegressionCommand).parse(JSON.parse(text));
  const identity = HealingIdentity.parse({
    ...evidence.identity,
    personalities: ordered,
  });
  const old = evidence.identity.personalities[0]?.name;
  if (old === undefined) throw new Error("Fixture healer name missing");
  const native = evidence.native.map((row) => ({
    ...row,
    response: row.response.replaceAll(old, eligible.name),
  }));
  return { ...evidence, commands, identity, native };
}

async function abortedFixture(directory: string) {
  const evidence = abortJournal();
  const database = path.join(directory, "database/the-storm.db");
  await mkdir(path.dirname(database), { recursive: true });
  await querySqlite(
    database,
    "CREATE TABLE rwf_match (id TEXT, winner TEXT, humans INTEGER, bots INTEGER, recording_file TEXT, recording_bytes INTEGER, dropped_frames INTEGER)",
  );
  await querySqlite(
    database,
    "CREATE TABLE rwf_match_player (match_id TEXT, player TEXT, result TEXT, credits_owed INTEGER, payout_status TEXT, credits_paid INTEGER)",
  );
  const match = evidence.settlement.matches[0],
    player = evidence.settlement.players[0];
  if (match === undefined || player === undefined)
    throw new Error("Fixture abort settlement missing");
  await querySqlite(
    database,
    `INSERT INTO rwf_match VALUES ('${match.id}', NULL, 1, 7, '${match.recording_file}', 120, 0)`,
  );
  await querySqlite(
    database,
    `INSERT INTO rwf_match_player VALUES ('${match.id}', '${player.player}', 'STOPPED', 0, 'NONE', 0)`,
  );
  return {
    evidence,
    settlement: {
      database,
      sha256: await digestFile(database),
      rows: evidence.settlement,
    },
  };
}

async function captured(directory: string, entry: Entry, inputs: Inputs) {
  const receipt = (
    evidence: NativeEvidence,
    details: Record<string, unknown>,
  ) => nativeReceipt({ directory, entry, inputs }, evidence, details);
  switch (entry.name) {
    case "human-combat": {
      const commands = humanJournal();
      const measured = regressionJournal(commands, entry.name);
      const roster = measured.transitions[0]?.fighters;
      if (roster === undefined) throw new Error("Fixture human roster missing");
      const recording = [
        `H\t3\t${measured.match}`,
        ...roster.map(
          (row) =>
            `R\t${row.body}\t${row.team}\t${row.kit}\t${row.bot.toString()}`,
        ),
        "N\t0\tx\t0\t0\t0\tfalse\tfalse\t1\t0\t0\tMISSING",
        "X\t12\tRED\tLAST_TEAM_STANDING",
      ].join("\n");
      return receipt(
        { commands, recording },
        { combat: humanCombat(measured) },
      );
    }
    case "spectator-immunity": {
      const evidence = watcherFixture();
      return receipt(evidence, {
        spectator: spectatorImmunity(evidence).spectator,
        watcher_sha256: await jsonDigest(
          directory,
          "watcher.json",
          evidence.identity,
        ),
      });
    }
    case "last-human-abort": {
      const { evidence, settlement } = await abortedFixture(directory);
      const result = lastHumanAbort({ ...evidence, commands: evidence.rows });
      return receipt(
        { commands: evidence.rows, recording: evidence.recording },
        {
          abort: result.abort,
          boundary_sha256: await jsonDigest(
            directory,
            "boundary.json",
            evidence.boundary,
          ),
          settlement_sha256: await jsonDigest(
            directory,
            "settlement.json",
            settlement,
          ),
          server_log_sha256: await textDigest(
            directory,
            "server.log",
            evidence.log,
          ),
        },
      );
    }
    case "healing-and-lifecycle": {
      const evidence = await healedFixture();
      return receipt(evidence, {
        healing: healingLifecycle(evidence).healing,
        healing_sha256: await jsonDigest(
          directory,
          "healing.json",
          evidence.identity,
        ),
        original_npc_save: await file(
          directory,
          "npc-save/citizens-saves.yml",
          evidence.npcSave,
        ),
      });
    }
    case "native-team-advancement": {
      const evidence = teamFixture();
      return receipt(evidence, {
        movement: nativeTeam(evidence).movement,
      });
    }
    case "native-los-and-knockback": {
      const evidence = meleeFixture();
      return receipt(evidence, {
        melee: nativeMelee(evidence).melee,
        melee_sha256: await jsonDigest(
          directory,
          "melee.json",
          evidence.identity,
        ),
      });
    }
    case "simulation-floors": {
      const text = simulationText(simulationFixture());
      await json(directory, "inputs.json", {
        schema: 1,
        acceptance: "unaccepted",
        diagnostic: true,
        retries: 0,
        inputs: { capture: inputs.capture, simulation: inputs.simulation },
      });
      return json(directory, "verification.json", {
        schema: 1,
        kind: entry.kind,
        acceptance: "unaccepted",
        diagnostic: true,
        retries: 0,
        inputs: { capture: inputs.capture, simulation: inputs.simulation },
        journal_sha256: await textDigest(directory, "simulation.jsonl", text),
        measured: simulationFloors(text),
        modelAccepted: false,
        humanTrainingPerformed: false,
        rolloutEnabled: false,
        allRegressionCasesMeasured: false,
        source: "authored-simulation",
        humanDemonstration: false,
        trainingData: false,
      });
    }
  }
}

/** Synthetic original-format codec fixtures only; no server, real actor, human review or accepted model. */
export async function regressionFixture(
  directory: string,
  native: unknown,
  actor: string,
  manifest: string,
) {
  await mkdir(directory);
  const producer = await file(
    directory,
    "classes/SimulationCapture.class",
    "synthetic compiled producer boundary, never executable Java",
  );
  const source = await file(
    directory,
    "SimulationCapture.java",
    "synthetic source boundary",
  );
  const classpath = await json(directory, "simulation-classpath.json", [
    path.dirname(producer.file),
  ]);
  const renderer = await file(
    directory,
    "renderer.fixture",
    "synthetic renderer boundary",
  );
  const inputs = Inputs.parse({
    capture: { native, renderer: [renderer], artifacts: { actor, manifest } },
    simulation: {
      classpath_sha256: classpath.sha256,
      classpath: [path.dirname(producer.file)],
      hashes: [
        { file: path.dirname(producer.file), kind: "directory", sha256: null },
        { ...producer, kind: "file" },
      ],
      sources: [source],
    },
    simulation_classpath: classpath,
  });
  const bindings = [];
  await json(directory, "inputs.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs,
  });
  for (const entry of cases) {
    const owned = path.join(directory, entry.name);
    const receipt = await captured(owned, entry, inputs);
    bindings.push({
      name: entry.name,
      directory: owned,
      receipt_sha256: receipt.sha256,
    });
  }
  const measured = await replayCases(new Snapshot(), inputs, bindings);
  const measuredFile = await json(
    directory,
    "measured-regressions.json",
    measured,
  );
  const suite = Suite.parse({
    schema: 1,
    kind: "rwf-original-regression-suite",
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    inputs,
    cases: bindings,
    measured,
    measured_sha256: measuredFile.sha256,
    modelAccepted: false,
    humanTrainingPerformed: false,
    rolloutEnabled: false,
  });
  const output = await json(directory, "regressions.json", suite);
  return { file: output.file, suite };
}
