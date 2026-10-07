import { z } from "zod";
import {
  RegressionSample,
  type RegressionAction,
} from "./regression-client.ts";
import { RegressionStream } from "./regression-stream.ts";

export const RegressionCommand = z.strictObject({
  command: z.string().min(1),
  state: RegressionSample,
});
export type RegressionCommand = z.infer<typeof RegressionCommand>;

function groupActions(actions: RegressionAction[]) {
  const grouped = new Map<number, RegressionAction[]>();
  for (const row of actions) {
    const rows = grouped.get(row.serverTick) ?? [];
    if (rows.some((other) => other.body === row.body))
      throw new Error("Regression body was driven twice in one tick");
    rows.push(row);
    grouped.set(row.serverTick, rows);
  }
  return grouped;
}

function originalTicks(stream: RegressionStream, offset: number) {
  const { ticks, actions, transitions } = stream;
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i]?.serverTick !== (ticks[i - 1]?.serverTick ?? -2) + 1)
      throw new Error("Regression tick journal has gaps");
  }
  const grouped = groupActions(actions);
  const interruptions = new Set(
    transitions
      .filter((row) => ["ENDED", "RESETTING"].includes(row.phase))
      .map((row) => row.serverTick),
  );
  for (const tick of ticks)
    checkBatch(tick, grouped.get(tick.serverTick) ?? [], interruptions, offset);
  const tickIds = new Set(ticks.map((tick) => tick.serverTick));
  if (actions.some((row) => !tickIds.has(row.serverTick)))
    throw new Error("Regression action lacks its original native tick");
  return ticks.reduce((sum, tick) => sum + tick.batchRows, 0);
}

function checkBatch(
  tick: RegressionStream["ticks"][number],
  rows: RegressionAction[],
  interruptions: Set<number>,
  offset: number,
) {
  const observed = rows.filter((row) => row.kit === "TROOPER").length;
  const interrupted =
    tick.batchRows === 0 && interruptions.has(tick.serverTick);
  if (
    (tick.live && tick.botTick + offset !== tick.serverTick) ||
    (rows.length > 0 && !tick.live) ||
    (!interrupted && tick.batchRows !== observed)
  )
    throw new Error(
      "Regression batch differs from original native observations",
    );
}

function actualDamage(stream: RegressionStream) {
  const roster = new Set(
    stream.transitions.flatMap((row) =>
      row.fighters.map((fighter) => fighter.body),
    ),
  );
  if (
    stream.damage.some(
      (row) => !roster.has(row.attacker) && !roster.has(row.victim),
    )
  )
    throw new Error("Foreign damage reached the regression journal");
  return stream.damage.filter((row) => row.before > row.after);
}

/** Rebuild measurements from every original drain, never from a summary's pass field. */
export function regressionJournal(raw: unknown, expectedCase: string) {
  const commands = z.array(RegressionCommand).min(3).parse(raw);
  const armed = commands.filter((row) => row.command.startsWith("arm "));
  if (
    armed.length !== 1 ||
    armed[0]?.command.startsWith(`arm ${expectedCase} `) !== true
  )
    throw new Error("Regression journal needs exactly one original case arm");
  const match = z.uuid().parse(armed[0].state.match);
  const stream = new RegressionStream(match, expectedCase);
  for (const entry of commands) stream.append(entry.state);
  const { before, after, offset } = stream.complete(commands.at(-1));
  const batchRows = originalTicks(stream, offset);
  if (
    batchRows !==
      after.submitted -
        before.submitted +
        after.skipped -
        before.skipped +
        after.rejected -
        before.rejected ||
    after.submitted !== after.deadlineMet + after.deadlineMissed
  )
    throw new Error(
      "Regression submissions differ from the original batch journal",
    );
  const measuredDamage = actualDamage(stream);
  const counts = {
    "authored-kit": stream.actions.filter(
      (row) => row.decision === "authored-kit",
    ).length,
    ineligible: stream.actions.filter((row) => row.decision === "ineligible")
      .length,
    unavailable: stream.actions.filter((row) => row.decision === "unavailable")
      .length,
    applied: stream.actions.filter((row) => row.decision === "applied").length,
  };
  return {
    match,
    sequence: stream.sequence,
    actions: stream.actions,
    ticks: stream.ticks,
    damage: stream.damage,
    probes: stream.probes,
    transitions: stream.transitions,
    counts,
    batchRows,
    before,
    after,
    damageEvents: measuredDamage.length,
    damageAmount: measuredDamage.reduce(
      (sum, row) => sum + row.before - row.after,
      0,
    ),
    appliedAges: [0, 1, 2].map(
      (age) =>
        stream.actions.filter(
          (row) => row.ticket !== null && row.botTick - row.ticket.tick === age,
        ).length,
    ),
  };
}
