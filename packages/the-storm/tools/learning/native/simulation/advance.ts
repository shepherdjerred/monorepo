import { z } from "zod";
import {
  simulationContract as wire,
  type SimulationBody,
  type SimulationTick,
  type SimulationRun,
  type SimulationEnd,
  type SimulationMetrics,
} from "./wire.ts";

type Sample = {
  x: number;
  z: number;
  walked: number;
  furthest: number;
  slot: string;
};
type Contact = {
  tick: number;
  widths: Map<string, number>;
  paths: Map<number, Sample>;
};

/** Independent replay of Advance's exact sample/anchor/contact rules over original ticks. */
export class SimulationAdvance {
  private readonly origins = new Map<number, SimulationBody>();
  private readonly samples = new Map<number, Sample>();
  private readonly widths = new Map<string, number>();
  private readonly by10 = new Map<number, number>();
  private contact: Contact | undefined;
  private tick = -1;
  private bodies: SimulationBody[] = [];
  constructor(readonly run: SimulationRun) {}

  append(row: SimulationTick) {
    if (
      row.run !== this.run.run ||
      row.tick !== this.tick + 1 ||
      row.ready !== (row.tick !== 0)
    )
      throw new Error(
        "Simulation lost, duplicated or reordered its original ticks",
      );
    this.roster(row.bodies);
    this.tick = row.tick;
    this.bodies = row.bodies;
    if (!row.ready) return;
    if (
      this.contact === undefined &&
      row.bodies.some((body) => !body.alive || body.attacks.length > 0)
    ) {
      this.sample(row.bodies);
      this.contact = {
        tick: row.tick,
        widths: this.spread(row.bodies),
        paths: new Map(this.samples),
      };
    }
    if (row.tick === wire.spreadTick)
      this.spread(row.bodies).forEach((width, team) =>
        this.widths.set(team, width),
      );
    if (row.tick % wire.sampleTicks === 0) this.sample(row.bodies);
    if (row.tick === wire.forwardTick)
      this.samples.forEach((sample, id) => this.by10.set(id, sample.furthest));
  }

  private roster(bodies: SimulationBody[]) {
    for (const [index, body] of bodies.entries()) {
      const team = index < wire.perTeam ? "RED" : "BLUE";
      if (
        body.id !== index + 1 ||
        body.team !== team ||
        body.kit !== wire.lineup[index % wire.perTeam] ||
        (this.bodies[index]?.alive === false && body.alive) ||
        body.attacks.some(
          (target) => target <= wire.perTeam === body.id <= wire.perTeam,
        )
      )
        throw new Error(
          "Simulation body, lineup, life or attack target differs from its original roster",
        );
    }
  }

  private sample(bodies: SimulationBody[]) {
    for (const body of bodies) {
      const origin = this.origins.get(body.id) ?? body;
      this.origins.set(body.id, origin);
      const previous = this.samples.get(body.id);
      this.samples.set(body.id, {
        x: body.x,
        z: body.z,
        walked:
          (previous?.walked ?? 0) +
          (previous === undefined
            ? 0
            : Math.hypot(body.x - previous.x, body.z - previous.z)),
        furthest: Math.max(
          previous?.furthest ?? 0,
          Math.abs(body.x - origin.x),
        ),
        slot: body.slot === "" ? (previous?.slot ?? "") : body.slot,
      });
    }
  }

  private spread(bodies: SimulationBody[]) {
    const widths = new Map<string, number>();
    for (const team of ["RED", "BLUE"]) {
      const zs = bodies
        .filter((body) => body.team === team && body.alive)
        .map((body) => body.z);
      widths.set(team, zs.length === 0 ? 0 : Math.max(...zs) - Math.min(...zs));
    }
    return widths;
  }

  private metrics(team: "RED" | "BLUE", contact: Contact): SimulationMetrics {
    let path = 0,
      gained = 0,
      eligible = 0,
      crossed = 0;
    for (const body of this.bodies.filter((member) => member.team === team)) {
      const origin = this.origins.get(body.id),
        atContact = contact.paths.get(body.id),
        current = this.samples.get(body.id);
      if (
        origin === undefined ||
        atContact === undefined ||
        current === undefined
      )
        throw new Error("Simulation original sampled body missing");
      path += atContact.walked;
      gained += Math.hypot(atContact.x - origin.x, atContact.z - origin.z);
      if (current.slot !== "ANCHOR") {
        eligible++;
        if (z.number().parse(this.by10.get(body.id)) >= wire.third) crossed++;
      }
    }
    if (eligible === 0 || gained === 0)
      throw new Error("Simulation lacks forward or winding samples");
    return {
      team,
      widthAt8: z.number().parse(this.widths.get(team)),
      widthAtContact: z.number().parse(contact.widths.get(team)),
      forwardBy10: crossed / eligible,
      winding: path / gained,
    };
  }

  complete(end: SimulationEnd) {
    const contact = this.contact;
    if (
      contact === undefined ||
      end.run !== this.run.run ||
      end.tick !== this.tick ||
      end.contact !== contact.tick ||
      end.tick !== Math.max(wire.forwardTick, contact.tick)
    )
      throw new Error(
        "Simulation lacks its original first contact and bounded stopping tick",
      );
    const measured = [
      this.metrics("RED", contact),
      this.metrics("BLUE", contact),
    ];
    let maximumError = 0;
    for (const [index, actual] of measured.entries()) {
      const expected = end.measurements[index];
      if (expected?.team !== actual.team)
        throw new Error("Simulation Java team measurements differ");
      for (const key of [
        "widthAt8",
        "widthAtContact",
        "forwardBy10",
        "winding",
      ] as const) {
        const error = Math.abs(actual[key] - expected[key]);
        if (error > 1e-9)
          throw new Error(
            `Simulation original Java measurement differs: ${key}`,
          );
        maximumError = Math.max(maximumError, error);
      }
    }
    return {
      ...this.run,
      contact: contact.tick,
      ticks: this.tick + 1,
      measured,
      maximumError,
    };
  }
}
