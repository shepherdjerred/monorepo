import { SimulationAdvance } from "./advance.ts";
import {
  Header,
  Complete,
  SimulationRow,
  simulationContract as wire,
} from "./wire.ts";
import { Proof } from "#learning/promotion/contract.ts";

/** All fixed original runs, original ticks and independent Java/replay agreement are mandatory. */
export function simulationFloors(original: string) {
  if (!original.endsWith("\n") || original.includes("\r"))
    throw new Error("Simulation original journal is truncated");
  const lines = original.slice(0, -1).split("\n");
  if (lines.length > 16 * (wire.maximumTicks + 2) + 2)
    throw new Error("Simulation original journal exceeds its fixed bound");
  const rows = lines.map((line): unknown => JSON.parse(line));
  Header.parse(rows[0]);
  Complete.parse(rows.at(-1));
  const runs: ReturnType<SimulationAdvance["complete"]>[] = [];
  let active: SimulationAdvance | undefined;
  for (const raw of rows.slice(1, -1)) {
    const row = SimulationRow.parse(raw);
    switch (row.type) {
      case "run": {
        const index = runs.length;
        if (
          active !== undefined ||
          row.run !== index + 1 ||
          row.seed !== wire.firstSeed + index ||
          row.red !== wire.strategies[Math.floor(index / 4)] ||
          row.blue !== wire.strategies[index % 4]
        )
          throw new Error(
            "Simulation original strategy pair, seed or run order differs",
          );
        active = new SimulationAdvance(row);
        break;
      }
      case "tick": {
        if (active === undefined)
          throw new Error("Simulation tick lacks its original run");
        active.append(row);
        break;
      }
      case "end": {
        if (active === undefined)
          throw new Error("Simulation ending lacks its original run");
        runs.push(active.complete(row));
        active = undefined;
        break;
      }
      case "header":
      case "complete":
        throw new Error("Simulation original boundaries were duplicated");
    }
  }
  if (active !== undefined || runs.length !== 16)
    throw new Error(
      "Simulation original fixed strategy inventory is incomplete",
    );
  const teams = runs.flatMap((run) => run.measured);
  const widths = teams
    .flatMap((row) => [row.widthAt8, row.widthAtContact])
    .toSorted((a, b) => a - b);
  const attacking = new Set<string>(wire.attackingStrategies);
  const forwards = runs.flatMap((run) =>
    run.measured
      .filter((row) => attacking.has(row.team === "RED" ? run.red : run.blue))
      .map((row) => row.forwardBy10),
  );
  const floors = Proof.shape.regressions.shape.simulation_floors.parse({
    strategy_pairs: runs.length,
    contacts: runs.length,
    minimum_width: Math.min(...widths),
    median_width: widths[Math.floor(widths.length / 2)],
    mean_forward:
      forwards.reduce((sum, value) => sum + value, 0) / forwards.length,
    maximum_winding: Math.max(...teams.map((row) => row.winding)),
  });
  return {
    floors,
    runs,
    rows: rows.length,
    frames: runs.reduce((sum, run) => sum + run.ticks * wire.perTeam * 2, 0),
    maximumReplayError: Math.max(...runs.map((run) => run.maximumError)),
  };
}
