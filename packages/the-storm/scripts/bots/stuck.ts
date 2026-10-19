#!/usr/bin/env bun
/**
 * Summarises how bots moved in one match from its decision trace
 * (`plugins/TheStorm/rwfbots-traces/<matchId>.gz`): the longest time each bot
 * stood within a block and a half of one spot, how often it decided with no
 * path, how often its option flip-flopped (A, B, A on consecutive steps), and
 * which route failures and recoveries it hit.
 *
 *   bun run bots:stuck <trace.gz> [--still 8] [--json]
 *
 * Intentional holds (HOLD_SLOT, HOLD_ANGLE, RETAKE holds, healing) are
 * reported separately from standing still while trying to go somewhere.
 */
import { constants, gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { z } from "zod";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    still: { type: "string", default: "8" },
    json: { type: "boolean", default: false },
  },
});
const trace = z.string().min(1).parse(positionals[0]);
const stillSeconds = z.coerce.number().positive().parse(values.still);

const RowSchema = z.object({
  tick: z.coerce.number().int(),
  bot: z.coerce.number().int(),
  epoch: z.coerce.number().int(),
  option: z.string(),
  label: z.string(),
  waypoints: z.coerce.number().int(),
  decided: z.string(),
  failure: z.string(),
  recovery: z.string(),
  x: z.coerce.number(),
  y: z.coerce.number(),
  z: z.coerce.number(),
});
type Row = z.infer<typeof RowSchema>;

const rows: Row[] = [];
const text = new TextDecoder().decode(
  gunzipSync(await Bun.file(trace).arrayBuffer(), {
    // A match stopped while live leaves its trace unterminated; read what was written.
    finishFlush: constants.Z_SYNC_FLUSH,
  }),
);
// Only complete lines: an unterminated trace can end part-way through one.
const lines = text.split("\n").slice(0, -1);
for (const entry of lines) {
  if (entry === "") continue;
  const f = entry.split("\t");
  if (f.length < 19)
    throw new Error(
      `trace line predates movement columns: ${entry.slice(0, 60)}`,
    );
  rows.push(
    RowSchema.parse({
      tick: f[1],
      bot: f[2],
      epoch: f[3],
      option: f[4],
      label: f[5],
      waypoints: f[10],
      decided: f[11],
      failure: f[12],
      recovery: f[13],
      x: f[14],
      y: f[15],
      z: f[16],
    }),
  );
}

/** Plan labels whose purpose is to stand still. */
function holding(row: Row): boolean {
  return /:(?:hold|heal|cover)$/u.test(row.label) && row.failure === "-";
}

type Stretch = { seconds: number; tick: number; at: string; labels: string };
type BotReport = {
  bot: number;
  decisions: number;
  noPathShare: number;
  flipShare: number;
  stuckSeconds: number;
  longestStuck: Stretch | undefined;
  heldSeconds: number;
  failures: Record<string, number>;
  recoveries: Record<string, number>;
};

/** Steps whose decided option returns to the one two steps back after changing in between. */
function flipCount(list: Row[]): number {
  let flips = 0;
  for (let i = 2; i < list.length; i++) {
    const [a, b, c] = [list[i - 2], list[i - 1], list[i]];
    if (
      a?.epoch === c?.epoch &&
      a?.decided === c?.decided &&
      b?.decided !== c?.decided
    )
      flips++;
  }
  return flips;
}

function tally(
  list: Row[],
  key: (row: Row) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of list) {
    const value = key(row);
    if (value !== undefined) counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** The index of the last row from {@code start} still within a block and a half of it. */
function stillUntil(list: Row[], start: number): number {
  const anchor = list[start];
  if (anchor === undefined) return start;
  let end = start;
  for (let next = list[end + 1]; next !== undefined; next = list[end + 1]) {
    if (next.epoch !== anchor.epoch) return end;
    if (Math.hypot(next.x - anchor.x, next.z - anchor.z) >= 1.5) return end;
    end++;
  }
  return end;
}

/** Every stretch of at least {@code stillSeconds} spent within a block and a half of one spot. */
function stillStretches(list: Row[]): { rows: Row[]; seconds: number }[] {
  const stretches: { rows: Row[]; seconds: number }[] = [];
  let start = 0;
  while (start < list.length) {
    const end = stillUntil(list, start);
    const stretch = list.slice(start, end + 1);
    const seconds =
      ((stretch.at(-1)?.tick ?? 0) - (stretch[0]?.tick ?? 0)) / 20;
    if (seconds >= stillSeconds) stretches.push({ rows: stretch, seconds });
    start = end + 1;
  }
  return stretches;
}

function report(bot: number, list: Row[]): BotReport {
  let stuckSeconds = 0;
  let heldSeconds = 0;
  let longest: Stretch | undefined;
  for (const { rows: stretch, seconds } of stillStretches(list)) {
    if (stretch.filter((row) => holding(row)).length / stretch.length >= 0.8) {
      heldSeconds += seconds;
      continue;
    }
    stuckSeconds += seconds;
    const anchor = stretch[0];
    if (
      anchor === undefined ||
      (longest !== undefined && seconds <= longest.seconds)
    )
      continue;
    longest = {
      seconds,
      tick: anchor.tick,
      at: `${anchor.x.toFixed(1)},${anchor.y.toFixed(1)},${anchor.z.toFixed(1)}`,
      labels: [...new Set(stretch.map((row) => row.label))]
        .slice(0, 4)
        .join(" "),
    };
  }
  return {
    bot,
    decisions: list.length,
    noPathShare:
      list.filter((row) => row.waypoints === 0 && !holding(row)).length /
      list.length,
    flipShare: list.length > 2 ? flipCount(list) / (list.length - 2) : 0,
    stuckSeconds,
    longestStuck: longest,
    heldSeconds,
    failures: tally(list, (row) =>
      row.failure === "-" ? undefined : row.failure,
    ),
    recoveries: tally(list, (row) =>
      row.recovery === "NONE" ? undefined : row.recovery,
    ),
  };
}

const byBot = Map.groupBy(rows, (row) => row.bot);
const reports = [...byBot]
  .map(([bot, list]) =>
    report(
      bot,
      list.toSorted((a, b) => a.tick - b.tick),
    ),
  )
  .toSorted((a, b) => b.stuckSeconds - a.stuckSeconds);

function line(r: BotReport): string {
  const longest =
    r.longestStuck === undefined
      ? "-"
      : `${r.longestStuck.seconds.toFixed(0)} s at ${r.longestStuck.at} (${r.longestStuck.labels})`;
  return (
    `bot ${r.bot.toString().padStart(2)}  stuck ${r.stuckSeconds.toFixed(0).padStart(4)} s  ` +
    `held ${r.heldSeconds.toFixed(0).padStart(4)} s  no-path ${(100 * r.noPathShare).toFixed(0).padStart(3)}%  ` +
    `flips ${(100 * r.flipShare).toFixed(1).padStart(4)}%  longest ${longest}  ` +
    `failures ${JSON.stringify(r.failures)} recoveries ${JSON.stringify(r.recoveries)}`
  );
}

if (values.json) {
  await Bun.write(Bun.stdout, `${JSON.stringify(reports, null, 2)}\n`);
} else {
  const flips = reports.reduce(
    (sum, r) => sum + r.flipShare * Math.max(0, r.decisions - 2),
    0,
  );
  const summary =
    `${byBot.size.toString()} bots, ${rows.length.toString()} decisions; ` +
    `stuck (still >= ${stillSeconds.toString()} s, not holding) ` +
    `${reports.reduce((sum, r) => sum + r.stuckSeconds, 0).toFixed(0)} s in total; ` +
    `option flip-flops ${((100 * flips) / rows.length).toFixed(1)}% of steps`;
  await Bun.write(
    Bun.stdout,
    [summary, ...reports.map((r) => line(r))].join("\n") + "\n",
  );
}
