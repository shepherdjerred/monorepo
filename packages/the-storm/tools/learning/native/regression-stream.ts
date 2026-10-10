import { z } from "zod";
import type {
  RegressionSample,
  RegressionAction,
} from "./regression-client.ts";
import { checkRegressionAction } from "./regression-actions.ts";

type Sample = z.infer<typeof RegressionSample>;
type Fighter = Sample["transitions"][number]["fighters"][number];
type Row =
  | Sample["actions"][number]
  | Sample["ticks"][number]
  | Sample["damage"][number]
  | Sample["probes"][number]
  | Sample["transitions"][number];

/** One original case's monotonic journal, including actions interrupted by synchronous endings. */
export class RegressionStream {
  sequence = 0;
  offset: number | undefined;
  readonly actions: RegressionAction[] = [];
  readonly ticks: Sample["ticks"] = [];
  readonly damage: Sample["damage"] = [];
  readonly probes: Sample["probes"] = [];
  readonly transitions: Sample["transitions"] = [];
  before: Sample["inference"] = null;
  after: Sample["inference"] = null;
  private lastServerTick = -1;
  private phase = "LOBBY";
  private readonly roster = new Map<string, Fighter>();
  private readonly lives = new Map<string, number>();

  constructor(
    readonly match: string,
    private readonly expectedCase: string,
  ) {}

  append(state: Sample) {
    if (
      state.caseName !== "" &&
      (state.caseName !== this.expectedCase || state.match !== this.match)
    )
      throw new Error("Foreign regression case or match reached the journal");
    const rows = [
      ...state.actions,
      ...state.ticks,
      ...state.damage,
      ...state.probes,
      ...state.transitions,
    ].sort((a, b) => a.sequence - b.sequence);
    if (rows.length > 5000)
      throw new Error("Regression drain exceeded its original bound");
    for (const row of rows) this.row(row);
    if (state.sequence !== this.sequence)
      throw new Error("Regression drain counter differs");
    if (state.transitions.some((row) => row.match !== this.match))
      throw new Error("Foreign regression transition match");
    this.actions.push(...state.actions);
    this.ticks.push(...state.ticks);
    this.damage.push(...state.damage);
    this.probes.push(...state.probes);
    this.transitions.push(...state.transitions);
    if (state.inference !== null) this.metrics(state.inference);
  }

  private row(row: Row) {
    if (
      row.sequence !== ++this.sequence ||
      row.serverTick < this.lastServerTick
    )
      throw new Error(
        "Regression journal lost, duplicated or reordered original rows",
      );
    this.lastServerTick = row.serverTick;
    if ("fighters" in row) this.members(row);
    else if ("body" in row) this.action(row);
    else if ("player" in row) this.probe(row);
  }

  private probe(row: Sample["probes"][number]) {
    const player = this.roster.get(row.player);
    const bot = this.roster.get(row.bot);
    if (
      player === undefined ||
      bot === undefined ||
      this.phase !== "LIVE" ||
      row.match !== this.match ||
      player.bot ||
      player.alive !== row.playerAlive ||
      !bot.bot ||
      bot.alive !== row.botAlive ||
      bot.kit !== row.botKit ||
      player.team === bot.team
    )
      throw new Error(
        "Regression player probe differs from the original native roster",
      );
  }

  private members(row: Sample["transitions"][number]) {
    this.phase = row.phase;
    this.roster.clear();
    for (const fighter of row.fighters) {
      if (this.roster.has(fighter.body))
        throw new Error("Duplicated regression roster identity");
      this.roster.set(fighter.body, fighter);
    }
  }

  private action(row: RegressionAction) {
    const fighter = this.roster.get(row.body);
    if (
      fighter === undefined ||
      this.phase !== "LIVE" ||
      !fighter.bot ||
      !fighter.alive ||
      fighter.kit !== row.kit.toLowerCase() ||
      row.life < (this.lives.get(row.body) ?? 0)
    )
      throw new Error(
        "Regression action differs from the current native roster or life",
      );
    this.lives.set(row.body, row.life);
    if (row.match !== this.match)
      throw new Error("Foreign regression action match");
    checkRegressionAction(row);
    if (
      (row.targetId === null) !== (row.targetBody === null) ||
      (row.targetBody !== null && !this.roster.has(row.targetBody))
    )
      throw new Error(
        "Regression target body differs from the original native roster",
      );
    const offset = row.serverTick - row.botTick;
    if (this.offset !== undefined && offset !== this.offset)
      throw new Error("Regression body clock alignment changed");
    this.offset = offset;
  }

  private metrics(current: NonNullable<Sample["inference"]>) {
    this.before ??= current;
    const previous = this.after;
    if (
      previous !== null &&
      Object.entries(current).some(
        ([key, value]) => value < z.number().parse(Reflect.get(previous, key)),
      )
    )
      throw new Error("Regression inference counters moved backwards");
    this.after = current;
  }

  complete(last: { command: string; state: Sample } | undefined) {
    if (last?.command !== "release" || last.state.result !== "released")
      throw new Error(
        "Regression journal lacks a complete original native case",
      );
    if (
      this.before === null ||
      this.after === null ||
      this.offset === undefined ||
      this.actions.length === 0
    )
      throw new Error(
        "Regression journal lacks original native controls and counters",
      );
    if (
      !this.transitions.some((row) => row.phase === "LIVE") ||
      !this.transitions.some((row) =>
        ["ENDED", "RESETTING"].includes(row.phase),
      )
    )
      throw new Error(
        "Regression journal lacks a complete original native case",
      );
    return { before: this.before, after: this.after, offset: this.offset };
  }
}
