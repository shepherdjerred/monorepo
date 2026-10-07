import type { LoadSample, LoadTick } from "./load-client.ts";

/** Frozen before boot; no match selection, retries, model updates or damage overrides. */
export const loadProtocol = {
  version: 1,
  counts: [20, 50, 100],
  baselineTicks: 1800,
  liveTicks: 3000,
  fullRosterTicks: 200,
  maxMatches: 30,
  phaseDeadlineMs: 20 * 60_000,
  serverP95Milliseconds: 50,
  deadlineFraction: 0.99,
  resources: { cpus: 4, heap: "8G", memoryLimit: "10g" },
  control:
    "all native Troopers at 20 Hz, authored navigation and aim; no governor thinning or habit perturbations",
} as const;

export function percentile(
  values: readonly number[],
  quantile: number,
): number {
  if (values.length === 0) throw new Error("empty native tick population");
  const sorted = values.toSorted((a, b) => a - b);
  const value = sorted[Math.ceil(sorted.length * quantile) - 1];
  if (value === undefined) throw new Error("invalid native tick quantile");
  return value;
}

export function loadSummary(
  bots: number,
  ticks: readonly LoadTick[],
  before: LoadSample,
  after: LoadSample,
) {
  const first = before.inference;
  const last = after.inference;
  if (first === undefined || last === undefined)
    throw new Error("load inference metrics missing");
  const live = ticks.filter((tick) => tick.live);
  const full = live.filter(
    (tick) => tick.alive === bots && tick.observed === bots,
  );
  const difference = (key: keyof typeof first) => last[key] - first[key];
  const submitted = difference("submitted");
  const skipped = difference("skipped");
  const rejected = difference("rejected");
  const deadlineMet = difference("deadlineMet");
  const deadlineMissed = difference("deadlineMissed");
  const pending = submitted - deadlineMet - deadlineMissed;
  const attempts = submitted + skipped + rejected;
  if (pending < 0 || deadlineMet < 0 || deadlineMissed < 0 || attempts <= 0)
    throw new Error("load deadline accounting is inconsistent");
  const fraction = deadlineMet / attempts;
  const total = (key: "applied" | "unavailable" | "ineligible") =>
    live.reduce((accumulator, tick) => accumulator + tick[key], 0);
  const p95 = percentile(
    ticks.map((tick) => tick.milliseconds),
    0.95,
  );
  const liveP95 = percentile(
    live.map((tick) => tick.milliseconds),
    0.95,
  );
  const fullP95 =
    full.length === 0
      ? null
      : percentile(
          full.map((tick) => tick.milliseconds),
          0.95,
        );
  const damage = after.damage - before.damage;
  const applied = total("applied");
  const checks = {
    liveCoverage: live.length >= loadProtocol.liveTicks,
    fullRosterCoverage: full.length >= loadProtocol.fullRosterTicks,
    fullBatch: last.maximumBatch === bots,
    serverP95: p95 < loadProtocol.serverP95Milliseconds,
    liveP95: liveP95 < loadProtocol.serverP95Milliseconds,
    fullRosterP95:
      fullP95 !== null && fullP95 < loadProtocol.serverP95Milliseconds,
    deadlines: fraction >= loadProtocol.deadlineFraction,
    actionDelivery: applied > 0,
    nativeDamage: damage > 0,
    observationCoverage: live.every(
      (tick) =>
        tick.observed === tick.applied + tick.unavailable + tick.ineligible,
    ),
    actionAges:
      after.ages.reduce(
        (sum, age, index) => sum + age - (before.ages[index] ?? 0),
        0,
      ) === applied,
  };
  return {
    bots,
    ticks: ticks.length,
    liveTicks: live.length,
    fullRosterTicks: full.length,
    aliveMean: live.reduce((sum, tick) => sum + tick.alive, 0) / live.length,
    aliveMinimum: Math.min(...live.map((tick) => tick.alive)),
    p95,
    liveP95,
    fullRosterP95: fullP95,
    maximumMilliseconds: Math.max(...ticks.map((tick) => tick.milliseconds)),
    maximumInferenceMilliseconds: last.maximumNanos / 1_000_000,
    submitted,
    skipped,
    rejected,
    deadlineMet,
    deadlineMissed,
    pending,
    deadlineFraction: fraction,
    contextDrops: difference("contextDrops"),
    applied,
    unavailable: total("unavailable"),
    authoredIneligible: total("ineligible"),
    damage,
    damageEvents: after.damageEvents - before.damageEvents,
    ages: after.ages.map((age, index) => age - (before.ages[index] ?? 0)),
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}
