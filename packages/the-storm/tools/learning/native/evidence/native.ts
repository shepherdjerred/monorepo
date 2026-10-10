import path from "node:path";
import { z } from "zod";
import { type Originals, equal } from "./files.ts";
import {
  regressionJournal,
  RegressionCommand,
} from "#learning/native/regression-gate.ts";
import {
  humanCombat,
  humanRecording,
} from "#learning/native/regression/human-gate.ts";
import {
  lastHumanAbort,
  AbortSettlement,
} from "#learning/native/regression/abort-gate.ts";
import { spectatorImmunity } from "#learning/native/regression/watcher-gate.ts";
import {
  healingLifecycle,
  HealingIdentity,
  HealingPersonality,
} from "#learning/native/regression/healing-gate.ts";
import { nativeMelee } from "#learning/native/regression/melee-gate.ts";
import { nativeTeam } from "#learning/native/regression/team-gate.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";
import { root } from "#learning/sandbox.ts";
import { Digest } from "#learning/preference/gate.ts";

async function abort(
  original: Originals,
  commands: unknown,
  recording: string,
) {
  const boundary = await original.json(
    "boundary.json",
    original.digest("boundary_sha256"),
  );
  const settlement = z
    .strictObject({
      database: z.string(),
      sha256: Digest,
      rows: AbortSettlement,
    })
    .parse(
      await original.json(
        "settlement.json",
        original.digest("settlement_sha256"),
      ),
    );
  if (
    settlement.database !==
    path.join(original.directory, "database/the-storm.db")
  )
    throw new Error("Abort database belongs to another original case");
  await original.snapshot.add(settlement.database, settlement.sha256);
  const match = z.object({ match: z.uuid() }).parse(boundary).match;
  const rows = AbortSettlement.parse({
    matches: await querySqlite(
      settlement.database,
      `SELECT id, winner, humans, bots, recording_file, recording_bytes, dropped_frames FROM rwf_match WHERE id = '${match}'`,
    ),
    players: await querySqlite(
      settlement.database,
      `SELECT player, result, credits_owed, payout_status, credits_paid FROM rwf_match_player WHERE match_id = '${match}' ORDER BY player`,
    ),
  });
  equal(
    rows,
    settlement.rows,
    "Abort rows differ from the original persisted database",
  );
  await original.snapshot.add(settlement.database, settlement.sha256);
  return lastHumanAbort({
    commands,
    boundary,
    settlement: rows,
    recording,
    log: await original.text(
      "server.log",
      original.digest("server_log_sha256"),
    ),
  });
}

async function healing(
  original: Originals,
  commands: unknown,
  native: unknown,
  recording: string,
) {
  const identity = HealingIdentity.parse(
    await original.json("healing.json", original.digest("healing_sha256")),
  );
  for (const personality of identity.personalities) {
    const file = path.join(
      root,
      "server/owned/plugins/TheStorm/rwfbots/personalities",
      `${personality.id}.yml`,
    );
    await original.snapshot.add(file, personality.sha256);
    const content = z
      .object({
        id: HealingPersonality.shape.id,
        name: HealingPersonality.shape.name,
        quirks: HealingPersonality.shape.quirks,
      })
      .parse(Bun.YAML.parse(await Bun.file(file).text()));
    equal(
      { ...content, sha256: personality.sha256 },
      personality,
      "Healing identity differs from original authored personality content",
    );
  }
  const npc = z
    .strictObject({ file: z.string(), sha256: Digest })
    .parse(original.receipt["original_npc_save"]);
  if (npc.file !== path.join(original.directory, "npc-save/citizens-saves.yml"))
    throw new Error("Healing NPC save belongs to another case");
  await original.snapshot.add(npc.file, npc.sha256);
  return healingLifecycle({
    commands,
    native,
    identity,
    recording,
    npcSave: await Bun.file(npc.file).text(),
  });
}

export async function replayNative(name: string, original: Originals) {
  const commands = await original.lines("commands.jsonl", "commands_sha256");
  const recording = await original.recording();
  if (name === "human-combat") {
    const measured = regressionJournal(
      z.array(RegressionCommand).parse(commands),
      name,
    );
    const combat = humanCombat(measured);
    humanRecording(recording, measured.match);
    equal(
      combat,
      original.receipt["combat"],
      "Human combat receipt differs from original replay",
    );
    return { measured };
  }
  if (name === "last-human-abort") {
    const result = await abort(original, commands, recording);
    equal(
      result.abort,
      original.receipt["abort"],
      "Abort receipt differs from original replay",
    );
    return result;
  }
  const native = await original.lines(
    "native-commands.jsonl",
    "native_commands_sha256",
  );
  switch (name) {
    case "spectator-immunity": {
      const result = spectatorImmunity({
        commands,
        native,
        recording,
        identity: await original.json(
          "watcher.json",
          original.digest("watcher_sha256"),
        ),
      });
      equal(
        result.spectator,
        original.receipt["spectator"],
        "Spectator receipt differs from original replay",
      );
      return result;
    }
    case "healing-and-lifecycle": {
      const result = await healing(original, commands, native, recording);
      equal(
        result.healing,
        original.receipt["healing"],
        "Healing receipt differs from original replay",
      );
      return result;
    }
    case "native-team-advancement": {
      const result = nativeTeam({ commands, native, recording });
      equal(
        result.movement,
        original.receipt["movement"],
        "Team movement receipt differs from original replay",
      );
      return result;
    }
    case "native-los-and-knockback": {
      const result = nativeMelee({
        commands,
        native,
        recording,
        identity: await original.json(
          "melee.json",
          original.digest("melee_sha256"),
        ),
      });
      equal(
        result.melee,
        original.receipt["melee"],
        "Melee receipt differs from original replay",
      );
      return result;
    }
    default:
      throw new Error("Unknown original native regression case");
  }
}
