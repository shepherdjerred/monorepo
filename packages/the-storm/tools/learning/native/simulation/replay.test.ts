import { describe, expect, it } from "vitest";
import { simulationFixture, simulationText } from "./fixture.ts";
import { simulationFloors } from "./replay.ts";
import type { SimulationBody, SimulationMetrics } from "./wire.ts";

type Rows = ReturnType<typeof simulationFixture>;
const floorEdits: {
  name: string;
  body: (body: SimulationBody, tick: number) => void;
  metrics: (metrics: SimulationMetrics) => void;
}[] = [
  {
    name: "width",
    body: (body) => {
      body.z = ((body.id - 1) % 8) * 2;
    },
    metrics: (team) => {
      team.widthAt8 = team.widthAtContact = 14;
    },
  },
  {
    name: "median",
    body: (body) => {
      body.z = (((body.id - 1) % 8) * 17) / 7;
    },
    metrics: (team) => {
      team.widthAt8 = team.widthAtContact = 17;
    },
  },
  {
    name: "forward",
    body: (body, tick) => {
      body.x = body.team === "RED" ? 4 + tick / 20 : 60 - tick / 20;
    },
    metrics: (team) => {
      team.forwardBy10 = 0;
    },
  },
  {
    name: "winding",
    body: (body, tick) => {
      const delta = Math.floor(tick / 10) % 2 === 1 ? 20 : 0;
      body.x = body.team === "RED" ? 4 + delta : 60 - delta;
    },
    metrics: (team) => {
      team.winding = 9;
    },
  },
];
const edits: { name: string; edit: (rows: Rows) => void }[] = [
  {
    name: "source",
    edit: (rows) => {
      const first = rows[0];
      if (first?.type === "header") Reflect.set(first, "source", "human");
    },
  },
  {
    name: "training",
    edit: (rows) => {
      const first = rows[0];
      if (first?.type === "header") Reflect.set(first, "trainingData", true);
    },
  },
  {
    name: "seed",
    edit: (rows) => {
      for (const row of rows) if (row.type === "run") row.seed++;
    },
  },
  {
    name: "strategy",
    edit: (rows) => {
      for (const row of rows) if (row.type === "run") row.blue = "RUSH";
    },
  },
  {
    name: "run-order",
    edit: (rows) => {
      rows.reverse();
    },
  },
  {
    name: "tick-loss",
    edit: (rows) => {
      rows.splice(50, 1);
    },
  },
  {
    name: "tick-duplication",
    edit: (rows) => {
      const tick = rows[50];
      if (tick !== undefined) rows.splice(50, 0, tick);
    },
  },
  {
    name: "foreign-run",
    edit: (rows) => {
      for (const row of rows) if (row.type === "tick") row.run = 2;
    },
  },
  {
    name: "roster-order",
    edit: (rows) => {
      for (const row of rows) if (row.type === "tick") row.bodies.reverse();
    },
  },
  {
    name: "kit",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "tick") {
          const body = row.bodies[1];
          if (body !== undefined) body.kit = "TROOPER";
        }
    },
  },
  {
    name: "friendly-target",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "tick") {
          const body = row.bodies[0];
          if (body?.attacks.length) body.attacks = [2];
        }
    },
  },
  {
    name: "missing-contact",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "tick")
          row.bodies.forEach((body) => {
            body.attacks = [];
          });
    },
  },
  {
    name: "contact-clock",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "end" && row.contact !== null) row.contact++;
    },
  },
  {
    name: "ending-clock",
    edit: (rows) => {
      for (const row of rows) if (row.type === "end") row.tick++;
    },
  },
  {
    name: "java-width",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "end")
          row.measurements.forEach((team) => {
            team.widthAt8++;
          });
    },
  },
  {
    name: "java-forward",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "end")
          row.measurements.forEach((team) => {
            team.forwardBy10 = 0.5;
          });
    },
  },
  {
    name: "java-winding",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "end")
          row.measurements.forEach((team) => {
            team.winding = 2;
          });
    },
  },
  {
    name: "missing-pair",
    edit: (rows) => {
      const start = rows.findIndex(
        (row) => row.type === "run" && row.run === 16,
      );
      rows.splice(start, rows.length - start - 1);
    },
  },
  {
    name: "unknown-slot",
    edit: (rows) => {
      for (const row of rows)
        if (row.type === "tick") {
          const body = row.bodies[0];
          if (body !== undefined) Reflect.set(body, "slot", "UNKNOWN");
        }
    },
  },
];

describe("original authored simulation advancement floors", () => {
  it("replays the fixed sixteen pairs and agrees with their independent Java measurements", () => {
    const value = simulationFloors(simulationText(simulationFixture()));
    expect(value.floors).toEqual({
      strategy_pairs: 16,
      contacts: 16,
      minimum_width: 28,
      median_width: 28,
      mean_forward: 1,
      maximum_winding: 1,
    });
    expect(value.frames).toBe(16 * 201 * 16);
    expect(value.runs.map((run) => run.seed)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 10),
    );
    expect(value.maximumReplayError).toBeLessThan(1e-9);
  });

  it("preserves contacts after the ten-second progress snapshot", () => {
    const value = simulationFloors(simulationText(simulationFixture(220)));
    expect(value.frames).toBe(16 * 221 * 16);
    expect(value.floors.mean_forward).toBe(1);
  });

  it.each(edits)("rejects changed original $name", ({ edit }) => {
    const rows = simulationFixture();
    edit(rows);
    expect(() => simulationFloors(simulationText(rows))).toThrow();
  });

  it("rejects a truncated original journal", () => {
    expect(() =>
      simulationFloors(simulationText(simulationFixture()).trimEnd()),
    ).toThrow();
  });

  it.each(floorEdits)(
    "rejects measured below-floor $name despite matching Java aggregates",
    (edit) => {
      const rows = simulationFixture();
      for (const row of rows) {
        if (row.type === "tick")
          row.bodies.forEach((body) => edit.body(body, row.tick));
        if (row.type === "end")
          row.measurements.forEach((team) => edit.metrics(team));
      }
      expect(() => simulationFloors(simulationText(rows))).toThrow();
    },
  );

  it("excludes anchors from the forward denominator", () => {
    const rows = simulationFixture();
    for (const row of rows) {
      if (row.type !== "tick") continue;
      for (const body of row.bodies) {
        if ((body.id - 1) % 8 === 3) body.x = body.team === "RED" ? 4 : 60;
      }
    }
    expect(simulationFloors(simulationText(rows)).floors.mean_forward).toBe(1);
  });

  it("excludes defensive teams from mean attacking advancement while still checking their widths and winding", () => {
    const rows = simulationFixture();
    const strategies = new Map(
      rows
        .filter((row) => row.type === "run")
        .map((row) => [
          row.run,
          new Set(
            [
              { team: "RED", strategy: row.red },
              { team: "BLUE", strategy: row.blue },
            ]
              .filter((side) => side.strategy === "TURTLE")
              .map((side) => side.team),
          ),
        ]),
    );
    for (const row of rows) {
      if (row.type === "tick") {
        const defensive = strategies.get(row.run);
        if (defensive === undefined)
          throw new Error("Synthetic strategy pairing missing");
        row.bodies
          .filter((body) => defensive.has(body.team))
          .forEach((body) => {
            body.x =
              body.team === "RED" ? 4 + row.tick / 20 : 60 - row.tick / 20;
          });
      }
      if (row.type === "end") {
        const defensive = strategies.get(row.run);
        if (defensive === undefined)
          throw new Error("Synthetic strategy pairing missing");
        row.measurements
          .filter((team) => defensive.has(team.team))
          .forEach((team) => {
            team.forwardBy10 = 0;
          });
      }
    }
    expect(simulationFloors(simulationText(rows)).floors.mean_forward).toBe(1);
  });
});
