import { z } from "zod";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";

const EntityProbeResult = z.enum(["Test passed. Count: 1", "Test failed"]);

const BodyProbe = z.strictObject({ command: z.string(), response: z.string() });
const Checkpoint = z.strictObject({
  startSequence: z.number().int().nonnegative(),
  endSequence: z.number().int().nonnegative(),
  phase: z.enum(["LIVE", "LOBBY"]),
  probes: z.array(BodyProbe).length(8),
});
export const AbortBoundary = z.strictObject({
  schema: z.literal(1),
  match: z.uuid(),
  player: z.uuid(),
  live: Checkpoint,
  departed: Checkpoint,
  debug: z.string(),
});
export const AbortSettlement = z.strictObject({
  matches: z
    .array(
      z.strictObject({
        id: z.uuid(),
        winner: z.null(),
        humans: z.literal(1),
        bots: z.literal(7),
        recording_file: z.string().min(1),
        recording_bytes: z.number().int().positive(),
        dropped_frames: z.literal(0),
      }),
    )
    .length(1),
  players: z
    .array(
      z.strictObject({
        player: z.uuid(),
        result: z.literal("STOPPED"),
        credits_owed: z.literal(0),
        payout_status: z.literal("NONE"),
        credits_paid: z.literal(0),
      }),
    )
    .length(1),
});

function probeCheckpoint(
  checkpoint: z.infer<typeof Checkpoint>,
  commands: RegressionCommand[],
  ids: string[],
  exists: boolean,
) {
  for (const sequence of [checkpoint.startSequence, checkpoint.endSequence]) {
    if (
      !commands.some(
        (row) =>
          row.state.sequence === sequence &&
          row.state.phase === checkpoint.phase,
      )
    )
      throw new Error(
        "Abort body probes lack their original native checkpoint",
      );
  }
  if (
    checkpoint.endSequence < checkpoint.startSequence ||
    JSON.stringify(checkpoint.probes.map((row) => row.command)) !==
      JSON.stringify(ids.map((id) => `execute if entity ${id}`)) ||
    checkpoint.probes.some(
      (row) =>
        (EntityProbeResult.parse(row.response.trim()) ===
          "Test passed. Count: 1") !==
        exists,
    )
  )
    throw new Error("Abort body probes differ from original native entities");
}

type Journal = ReturnType<typeof regressionJournal>;

function joinedRoster(
  measured: Journal,
  boundary: z.infer<typeof AbortBoundary>,
) {
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  const human = first?.fighters.find((row) => !row.bot);
  if (
    first?.fighters.length !== 8 ||
    first.fighters.filter((row) => !row.bot).length !== 1 ||
    first.fighters.some((row) => row.kit !== "trooper" || !row.alive) ||
    human?.body !== boundary.player ||
    boundary.match !== measured.match ||
    measured.counts.applied === 0
  )
    throw new Error(
      "Abort needs its original joined-player roster and applied Java controls",
    );
  return { first, human };
}

function originalStop(
  measured: Journal,
  boundary: z.infer<typeof AbortBoundary>,
  player: string,
) {
  const left = measured.transitions.find(
    (row) =>
      row.event === "Disconnect" &&
      row.phase === "LIVE" &&
      !row.fighters.some((f) => f.body === player),
  );
  const stopped = measured.transitions.find(
    (row) => row.event === "Stop" && row.phase === "RESETTING",
  );
  if (
    left?.phase !== "LIVE" ||
    stopped?.winner !== "" ||
    stopped.serverTick <= left.serverTick ||
    stopped.serverTick - left.serverTick > 120 ||
    boundary.live.phase !== "LIVE" ||
    boundary.departed.phase !== "LOBBY" ||
    boundary.live.endSequence >= left.sequence ||
    boundary.departed.startSequence <= stopped.sequence ||
    measured.actions.some((row) => row.sequence > stopped.sequence) ||
    measured.transitions.some(
      (row) => row.sequence > left.sequence && row.fighters.some((f) => !f.bot),
    )
  )
    throw new Error(
      "Abort lacks the original last-human disconnect and timely unpaid stop",
    );
  return stopped.serverTick - left.serverTick;
}

function stoppedSettlement(
  settlement: z.infer<typeof AbortSettlement>,
  matchId: string,
  player: string,
) {
  const match = settlement.matches[0];
  if (
    match?.id !== matchId ||
    settlement.players[0]?.player !== player ||
    !match.recording_file.endsWith(`/${matchId}.rwfrec.gz`)
  )
    throw new Error(
      "Abort settlement belongs to another original match or player",
    );
}

function stoppedRecording(recording: string, matchId: string) {
  const rows = recording
    .trim()
    .split("\n")
    .map((row) => row.split("\t"));
  const header = rows[0];
  const endings = rows.filter((row) => row[0] === "X");
  const roster = rows.filter((row) => row[0] === "R");
  const inputs = rows.filter((row) => row[0] === "N");
  if (
    header?.[0] !== "H" ||
    header[1] !== "3" ||
    header[2] !== matchId ||
    endings.length !== 1 ||
    endings[0]?.[2] !== "-" ||
    endings[0][3] !== "STOPPED" ||
    roster.length !== 8 ||
    roster.filter((row) => row[4] === "false").length !== 1 ||
    roster.some((row) => row[3] !== "trooper") ||
    inputs.length === 0 ||
    inputs.some((row) => row[11] !== "MISSING") ||
    rows.some((row) => row[0] === "P" && row[2] !== "0")
  )
    throw new Error(
      "Abort lacks its original stopped recording and automated provenance",
    );
}

/** Recount the original disconnect, native teardown, recording and persisted zero-credit result. */
export function lastHumanAbort(evidence: {
  commands: unknown;
  boundary: unknown;
  settlement: unknown;
  log: string;
  recording: string;
}) {
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, "last-human-abort");
  const boundary = AbortBoundary.parse(evidence.boundary);
  const settlement = AbortSettlement.parse(evidence.settlement);
  const { first, human } = joinedRoster(measured, boundary);
  const ticksToStop = originalStop(measured, boundary, human.body);
  const ids = [
    human.body,
    ...first.fighters
      .filter((row) => row.bot)
      .map((row) => row.body)
      .sort(),
  ];
  probeCheckpoint(boundary.live, commands, ids, true);
  probeCheckpoint(boundary.departed, commands, ids, false);
  if (
    !boundary.debug.includes("no bots in the match") ||
    !evidence.log.includes(
      `rwf match ${measured.match} has had no humans for PT5S; stopping`,
    ) ||
    !evidence.log.includes(`rwf match ${measured.match} stopped by Stop`)
  )
    throw new Error(
      "Abort lacks native grace-period and empty-roster evidence",
    );
  stoppedSettlement(settlement, measured.match, human.body);
  stoppedRecording(evidence.recording, measured.match);
  return {
    measured,
    abort: {
      player: human.body,
      botsDespawned: 7,
      ticksToStop,
      result: "STOPPED",
      creditsOwed: 0,
      creditsPaid: 0,
    },
  };
}
