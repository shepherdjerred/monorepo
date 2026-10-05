import { z } from "zod";

/**
 * The rwfbots load test's samples, their summary and the plan's bars, kept
 * apart from the server-driving test so a recorded run can be judged again:
 *
 *   bun tests/load/load-bars.ts .cache/e2e/load/rwf-load-4cpu-<time>.json
 */

/** One ten-second window of samples. */
export const WindowSchema = z.object({
  p95: z.number(),
  median: z.number(),
  max: z.number(),
  cpu: z.number(),
  level: z.number(),
  thinkP95: z.number(),
  /**
   * The p95 age, in ticks, of the decision each bot follows. Bots re-decide
   * every `tacticsEveryTicks` (5, 4 Hz), so this sits near 5 by design; it is
   * reported, not judged.
   */
  stalenessP95: z.number(),
  sectionsP95: z.number(),
  alive: z.number(),
  /**
   * Server ticks between the newest published board's snapshot and now: how
   * far the think loop trails the game. This is the plan's staleness bar.
   */
  boardLag: z.number(),
  /** Bots the last think job deferred for want of line-of-sight rays. */
  deferred: z.number(),
  /** The workstation's one-minute load average: other work on the host. */
  hostLoad: z.number(),
});
export type Window = z.infer<typeof WindowSchema>;

export const PhaseSchema = z.object({
  bots: z.number().int(),
  mspt: z.array(z.number()),
  windows: z.array(WindowSchema),
  matches: z.number().int(),
});
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * The plan's bars: the added p95 tick time at 100 bots, the think loop's lag
 * behind the game (snapshot to published decision), the governor's level,
 * and no think job slower than one tick at that level.
 */
export const bars = {
  addedP95Ms: 8,
  boardLagP95Ticks: 3,
  governorLevel: 0,
  overrunMs: 50,
} as const;

const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
const max = (values: number[]) => Math.max(0, ...values);

/** The nearest-rank `percentile` (0..1) of `values`; 0 when there are none. */
function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? 0;
}

export function summarise(phase: Phase) {
  const lags = phase.windows.map((w) => w.boardLag);
  return {
    bots: phase.bots,
    matches: phase.matches,
    aliveMean: mean(phase.windows.map((w) => w.alive)),
    msptAvg: mean(phase.mspt),
    p95: mean(phase.windows.map((w) => w.p95)),
    p95Worst: max(phase.windows.map((w) => w.p95)),
    msptMax: max(phase.windows.map((w) => w.max)),
    cpu: mean(phase.windows.map((w) => w.cpu)),
    thinkP95: max(phase.windows.map((w) => w.thinkP95)),
    sectionsP95: max(phase.windows.map((w) => w.sectionsP95)),
    stalenessP95: max(phase.windows.map((w) => w.stalenessP95)),
    level: max(phase.windows.map((w) => w.level)),
    boardLagP95: percentile(lags, 0.95),
    boardLagMax: max(lags),
    deferredMax: max(phase.windows.map((w) => w.deferred)),
    overruns: phase.windows.filter((w) => w.thinkP95 > bars.overrunMs).length,
    hostLoad: mean(phase.windows.map((w) => w.hostLoad)),
    windows: phase.windows.length,
  };
}
export type Row = ReturnType<typeof summarise>;

/** One bar checked against one phase. */
export type Verdict = {
  check: string;
  value: number;
  bar: number;
  pass: boolean;
};

/** Every bar against `rows` (the 0-bot baseline first). */
export function verdicts(rows: Row[]): Verdict[] {
  const base = rows.find((row) => row.bots === 0)?.p95 ?? Number.NaN;
  const hundred = rows.find((row) => row.bots === 100);
  const added = (hundred?.p95 ?? Number.NaN) - base;
  const out: Verdict[] = [
    {
      check: "added p95 MSPT at 100 bots",
      value: added,
      bar: bars.addedP95Ms,
      pass: added <= bars.addedP95Ms,
    },
    {
      check: "governor level at 100 bots",
      value: hundred?.level ?? Number.NaN,
      bar: bars.governorLevel,
      pass: hundred?.level === bars.governorLevel,
    },
  ];
  for (const row of rows.filter((candidate) => candidate.bots > 0)) {
    const at = `at ${row.bots.toString()} bots`;
    if (row.level === bars.governorLevel) {
      out.push({
        check: `think jobs over one tick ${at}`,
        value: row.overruns,
        bar: 0,
        pass: row.overruns === 0,
      });
    }
    out.push({
      check: `board lag p95 ticks ${at}`,
      value: row.boardLagP95,
      bar: bars.boardLagP95Ticks,
      pass: row.boardLagP95 <= bars.boardLagP95Ticks,
    });
  }
  return out;
}

if (import.meta.main) {
  const RecordedSchema = z.object({
    cpus: z.number().int(),
    phases: z.array(PhaseSchema),
  });
  const files = Bun.argv.slice(2);
  if (files.length === 0) {
    throw new Error("name one or more recorded rwf-load-*.json files");
  }
  let failed = false;
  for (const file of files) {
    const recorded = RecordedSchema.parse(await Bun.file(file).json());
    console.warn(`${file} (${recorded.cpus.toString()} CPUs)`);
    for (const verdict of verdicts(recorded.phases.map((p) => summarise(p)))) {
      failed ||= !verdict.pass;
      console.warn(
        `  ${verdict.pass ? "pass" : "FAIL"}  ${verdict.check}: ${verdict.value.toFixed(1)} (bar ${verdict.bar.toString()})`,
      );
    }
  }
  process.exitCode = failed ? 1 : 0;
}
