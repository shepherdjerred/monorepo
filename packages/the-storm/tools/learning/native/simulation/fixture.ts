import type { z } from "zod";
import {
  Body,
  Header,
  Run,
  Tick,
  End,
  Complete,
  type SimulationRow,
  simulationContract as wire,
} from "./wire.ts";

export const simulationText = (rows: z.infer<typeof SimulationRow>[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

/** Synthetic replay boundaries only; never original simulation, native or training evidence. */
export function simulationFixture(contact = 100) {
  const rows: z.infer<typeof SimulationRow>[] = [
    Header.parse({
      type: "header",
      schema: 1,
      contract: wire.contract,
      source: "authored-simulation",
      humanDemonstration: false,
      trainingData: false,
    }),
  ];
  for (let index = 0; index < 16; index++) {
    const run = index + 1;
    rows.push(
      Run.parse({
        type: "run",
        run,
        seed: 10 + index,
        red: wire.strategies[Math.floor(index / 4)],
        blue: wire.strategies[index % 4],
      }),
    );
    for (let tick = 0; tick <= Math.max(200, contact); tick++) {
      const bodies = Array.from({ length: 16 }, (_, i) =>
        Body.parse({
          id: i + 1,
          team: i < 8 ? "RED" : "BLUE",
          kit: wire.lineup[i % 8],
          x: i < 8 ? 4 + tick / 5 : 60 - tick / 5,
          z: 8 + (i % 8) * 4,
          alive: true,
          attacks: tick === contact && i === 0 ? [9] : [],
          slot: tick === 0 ? "" : i % 8 === 3 ? "ANCHOR" : "LANE",
        }),
      );
      rows.push(
        Tick.parse({ type: "tick", run, tick, ready: tick !== 0, bodies }),
      );
    }
    rows.push(
      End.parse({
        type: "end",
        run,
        tick: Math.max(200, contact),
        contact,
        measurements: ["RED", "BLUE"].map((team) => ({
          team,
          widthAt8: 28,
          widthAtContact: 28,
          forwardBy10: 1,
          winding: 1,
        })),
      }),
    );
  }
  rows.push(Complete.parse({ type: "complete", runs: 16 }));
  return rows;
}
