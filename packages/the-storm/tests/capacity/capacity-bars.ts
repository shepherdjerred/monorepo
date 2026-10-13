import { z } from "zod";
import { WindowSchema } from "#load/load-bars.ts";

export const totals = [64, 100, 128, 192, 256] as const;
export const TelemetrySchema = z.object({
  observations: z.number().int().nonnegative(),
  ageP95: z.number().int().nonnegative(),
  ageMax: z.number().int().nonnegative(),
  pendingMax: z.number().int().nonnegative(),
  lagP95: z.number().int().nonnegative(),
  governorMax: z.number().int().nonnegative(),
  overruns: z.number().int().nonnegative(),
  thinkMax: z.number().nonnegative(),
  heapPeak: z.number().int().nonnegative(),
  heapLimit: z.literal(8 * 1024 ** 3),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;
export const MemorySchema = z.object({
  current: z.number().int().positive(),
  peak: z.number().int().positive(),
  limit: z.literal(10 * 1024 ** 3),
});
export type Memory = z.infer<typeof MemorySchema>;
export const LifecycleSchema = z.object({
  elapsedMs: z.number().nonnegative(),
  windows: z.array(WindowSchema),
  memory: z.array(MemorySchema),
});
export type Lifecycle = z.infer<typeof LifecycleSchema>;
export const CapacityPhaseSchema = z.object({
  total: z.number().int(),
  measuredMs: z.number().nonnegative(),
  mspt: z.array(z.number().nonnegative()),
  windows: z.array(WindowSchema),
  telemetry: z.array(TelemetrySchema),
  memory: z.array(MemorySchema),
  matches: z.array(
    z.object({
      id: z.uuid(),
      bots: z.number().int(),
      humans: z.literal(1),
      arrivalMs: z.number(),
      arrival: LifecycleSchema,
      startup: TelemetrySchema,
      resetMs: z.number().optional(),
      reset: LifecycleSchema.optional(),
      resetTelemetry: TelemetrySchema.optional(),
    }),
  ),
});
export type CapacityPhase = z.infer<typeof CapacityPhaseSchema>;
type Verdict = { check: string; pass: boolean; value: number; bar: number };
const maximum = (values: number[]) => Math.max(...values);
const minimum = (values: number[]) => Math.min(...values);

/** Conservative tick gate: every sampled ten-second p95 must meet the bar. */
export function capacityVerdicts(phases: CapacityPhase[]): Verdict[] {
  return totals.flatMap((total) => capacityTierVerdicts(phases, total));
}

/** One tier uses every release bar, without claiming the remaining matrix passed. */
export function capacityTierVerdicts(
  phases: CapacityPhase[],
  total: (typeof totals)[number],
): Verdict[] {
  const baseline = phases.find((p) => p.total === 0);
  const base =
    baseline === undefined ||
    baseline.measuredMs < 90_000 ||
    baseline.windows.length < 8 ||
    baseline.telemetry.length < 8 ||
    baseline.mspt.length < 85 ||
    baseline.memory.length < 85
      ? Number.NaN
      : baseline.windows.reduce((sum, w) => sum + w.p95, 0) /
        baseline.windows.length;
  return judge(
    total,
    phases.find((p) => p.total === total),
    base,
    maximum((baseline?.telemetry ?? []).map((t) => t.heapPeak / t.heapLimit)),
  );
}

function complete(phase: CapacityPhase): boolean {
  return (
    phase.windows.length >= 14 &&
    phase.telemetry.length >= 14 &&
    phase.memory.length >= 140 &&
    phase.mspt.length >= 140
  );
}

function judge(
  total: number,
  phase: CapacityPhase | undefined,
  base: number,
  startupHeap: number,
): Verdict[] {
  const out: Verdict[] = [];
  const check = (label: string, value: number, bar: number, pass: boolean) =>
    out.push({
      check: `${total.toString()} total: ${label}`,
      value,
      bar,
      pass,
    });
  if (phase === undefined) {
    check("phase present", 0, 1, false);
    return out;
  }
  check(
    "full measuring window",
    phase.measuredMs,
    150_000,
    phase.measuredMs >= 150_000,
  );
  check("complete samples", phase.windows.length, 14, complete(phase));
  const p95 = maximum(phase.windows.map((w) => w.p95));
  check("added tick p95 ms", p95 - base, 8, p95 - base <= 8);
  check("tick p95 ms", p95, 50, p95 < 50);
  const lag = maximum(phase.telemetry.map((t) => t.lagP95));
  check("board lag p95 ticks", lag, 3, lag <= 3);
  const governor = maximum(phase.telemetry.map((t) => t.governorMax));
  check("governor", governor, 0, governor === 0);
  // Cleanup closes the interval too, including a live job completed after the final poll.
  const overruns = maximum([
    ...phase.telemetry.map((t) => t.overruns),
    ...phase.matches.flatMap((m) =>
      m.resetTelemetry === undefined ? [] : [m.resetTelemetry.overruns],
    ),
  ]);
  check("think jobs over 50 ms", overruns, 0, overruns === 0);
  const age = maximum(phase.telemetry.map((t) => t.ageP95));
  check("perception age p95 ticks", age, 5, age <= 5);
  const oldest = maximum(phase.telemetry.map((t) => t.ageMax));
  check("perception age max ticks", oldest, 10, oldest <= 10);
  const pending = maximum(phase.telemetry.map((t) => t.pendingMax));
  check("pending first perceptions", pending, 0, pending === 0);
  const observations = minimum(phase.telemetry.map((t) => t.observations));
  check(
    "living observations",
    observations,
    1,
    Number.isFinite(observations) && observations >= 1,
  );
  const heap = maximum([
    startupHeap,
    ...phase.telemetry.map((t) => t.heapPeak / t.heapLimit),
    ...phase.matches.map((m) => m.startup.heapPeak / m.startup.heapLimit),
    ...phase.matches.flatMap((m) =>
      m.resetTelemetry === undefined
        ? []
        : [m.resetTelemetry.heapPeak / m.resetTelemetry.heapLimit],
    ),
  ]);
  check("heap fraction", heap, 0.9, heap < 0.9);
  const container = maximum(
    [
      ...phase.memory,
      ...phase.matches.flatMap((m) => [
        ...m.arrival.memory,
        ...(m.reset?.memory ?? []),
      ]),
    ].map((m) => m.peak / m.limit),
  );
  check(
    "container fraction including startup and reset",
    container,
    0.9,
    container < 0.9,
  );
  const matches = phase.matches;
  check(
    "exact mixed roster and cleanup",
    matches.length,
    1,
    matches.length > 0 &&
      matches.every(
        (m) =>
          m.bots === total - 1 &&
          m.resetMs !== undefined &&
          m.reset !== undefined &&
          m.resetTelemetry !== undefined,
      ),
  );
  return out;
}
