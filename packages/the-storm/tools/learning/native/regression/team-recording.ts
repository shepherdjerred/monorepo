import { createHmac } from "node:crypto";
import { z } from "zod";
import type { regressionJournal } from "#learning/native/regression-gate.ts";
import { rwfRecordingSalt } from "#e2e/harness/rwf-settings.ts";
import { readTrails } from "#e2e/harness/rwf-trails.ts";

type Journal = ReturnType<typeof regressionJournal>;
export type TeamContext = {
  match: string;
  fighters: Journal["transitions"][number]["fighters"];
  duration: number;
  winner: string;
};

/** The sandbox's public test salt binds each recorded path to its original native body. */
export const teamPseudonym = (body: string) =>
  "p" +
  createHmac("sha256", rwfRecordingSalt)
    .update(body)
    .digest("hex")
    .slice(0, 16);

const Integer = z
  .string()
  .regex(/^-?\d+$/u)
  .transform(Number)
  .pipe(z.number().int());
const Tick = Integer.pipe(z.number().nonnegative());
const Frame = z.tuple([
  z.literal("F"),
  Tick,
  z.string(),
  Integer,
  Integer,
  Integer,
  Integer.pipe(z.number().min(0).max(255)),
  Integer.pipe(z.number().min(-64).max(64)),
  Integer.pipe(z.number().nonnegative()),
  Integer.pipe(z.number().min(0).max(8)),
  Integer.pipe(z.number().min(0).max(15)),
]);

function header(rows: string[][], context: TeamContext) {
  const head = z
    .tuple([
      z.literal("H"),
      z.literal("3"),
      z.uuid(),
      z.literal("training-yard"),
      z.string().regex(/^[a-f0-9]{64}$/u),
      z.string().regex(/^-?\d+$/u),
      z.literal("rwf-combat-1"),
    ])
    .parse(rows[0]);
  const seed = BigInt(head[5]);
  if (head[2] !== context.match || seed < -(2n ** 63n) || seed >= 2n ** 63n)
    throw new Error(
      "Team recording header differs from its original native match",
    );
  const expected = context.fighters
    .map((fighter) =>
      [
        "R",
        teamPseudonym(fighter.body),
        fighter.team.toUpperCase(),
        fighter.kit,
        "true",
      ].join("\t"),
    )
    .sort();
  const members = rows
    .slice(1, 17)
    .map((row) => row.join("\t"))
    .sort();
  if (JSON.stringify(members) !== JSON.stringify(expected))
    throw new Error(
      "Team recording roster differs from its original native bodies",
    );
  const ending = z
    .tuple([
      z.literal("X"),
      Tick,
      z.enum(["RED", "BLUE", "-"]),
      z.enum(["LAST_TEAM_STANDING", "DRAW"]),
    ])
    .parse(rows.at(-1));
  if (
    ending[1] !== context.duration ||
    ending[2] !==
      (context.winner === "" ? "-" : context.winner.toUpperCase()) ||
    ending[3] !== (context.winner === "" ? "DRAW" : "LAST_TEAM_STANDING")
  )
    throw new Error("Team recording lacks its exact original normal ending");
}

class Trajectories {
  private readonly ids: Set<string>;
  private readonly frames = new Map<string, number[]>();
  private readonly deaths = new Map<string, number>();
  private lastTick = -1;
  readonly attacks: { tick: number; attacker: string; victim: string }[] = [];

  constructor(private readonly context: TeamContext) {
    this.ids = new Set(context.fighters.map((row) => teamPseudonym(row.body)));
  }

  append(raw: string[]) {
    const tick = Tick.parse(raw[1]);
    if (tick < this.lastTick || tick > this.context.duration)
      throw new Error("Team recording lost original chronological rows");
    this.lastTick = tick;
    switch (raw[0]) {
      case "F":
        this.frame(Frame.parse(raw));
        break;
      case "I":
        this.intent(raw);
        break;
      case "E":
        this.event(raw);
        break;
      case undefined:
      default:
        throw new Error("Team recording contains an unexpected original row");
    }
  }

  private frame(row: z.infer<typeof Frame>) {
    const tick = row[1],
      id = row[2];
    if (!this.ids.has(id)) throw new Error("Foreign team frame body");
    const path = this.frames.get(id) ?? [];
    if (path.length > 0 && tick !== z.number().parse(path.at(-1)) + 2)
      throw new Error(
        "Team recording lost, duplicated or reordered native frames",
      );
    path.push(tick);
    this.frames.set(id, path);
  }

  private intent(raw: string[]) {
    const row = z
      .tuple([
        z.literal("I"),
        Tick,
        z.string().min(1),
        z.string().min(1),
        z.string(),
      ])
      .parse(raw);
    if (!this.ids.has(row[2])) throw new Error("Foreign team intent body");
    if (row[3] === "attack") {
      if (!this.ids.has(row[4])) throw new Error("Foreign team attack target");
      this.attacks.push({ tick: row[1], attacker: row[2], victim: row[4] });
    }
  }

  private event(raw: string[]) {
    const row = z
      .tuple([
        z.literal("E"),
        Tick,
        z.string().min(1),
        z.string().min(1),
        z.string(),
      ])
      .parse(raw);
    if (["died", "killed"].includes(row[2])) {
      if (!this.ids.has(row[3]) || this.deaths.has(row[3]))
        throw new Error("Foreign or duplicated native team death");
      this.deaths.set(row[3], row[1]);
    }
  }

  complete() {
    const firstTicks = new Set<number>();
    for (const id of this.ids) firstTicks.add(this.completePath(id));
    if (firstTicks.size !== 1)
      throw new Error(
        "Team recording native frame cadence differs across bodies",
      );
    return {
      frames: [...this.frames.values()].reduce(
        (sum, path) => sum + path.length,
        0,
      ),
      deaths: this.deaths.size,
    };
  }

  private completePath(id: string) {
    const path = this.frames.get(id);
    const first = path?.[0],
      last = path?.at(-1);
    const until = this.deaths.get(id) ?? this.context.duration;
    if (
      first === undefined ||
      last === undefined ||
      first > 1 ||
      last > until ||
      until - last > 2
    )
      throw new Error(
        "Team recording lacks a complete native living trajectory",
      );
    return first;
  }
}

/** Validate the whole original before the established full-lane metrics can read it. */
export function teamRecording(recording: string, context: TeamContext) {
  if (!recording.endsWith("\n") || recording.includes("\r"))
    throw new Error("Team recording is not a complete original newline stream");
  const lines = recording.slice(0, -1).split("\n");
  const rows = lines.map((line) => line.split("\t"));
  header(rows, context);
  const paths = new Trajectories(context);
  for (const row of rows.slice(17, -1)) paths.append(row);
  const completeness = paths.complete();
  const trails = readTrails(lines);
  if (
    context.duration < 200 ||
    trails.firstContact === undefined ||
    trails.firstContact <= 0
  )
    throw new Error(
      "Team recording lacks native contact or its ten-second window",
    );
  return { trails, completeness, attacks: paths.attacks };
}
