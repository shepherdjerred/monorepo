import { z } from "zod";
import { LoadSample, LoadTick } from "#learning/load-client.ts";
import { InferenceMetrics } from "#learning/inference.ts";
import {
  inferenceDrained,
  loadProtocol,
  loadSummary,
  percentile,
} from "#learning/load-gate.ts";

const Population = z.union([z.literal(20), z.literal(50), z.literal(100)]);
const Match = z
  .object({ seed: z.number().int().min(0).max(1_000_000_000), match: z.uuid() })
  .strict();
const Phase = z
  .object({
    bots: Population,
    ticks: z.array(LoadTick).min(1),
    matches: z.array(Match).min(1).max(loadProtocol.maxMatches),
    before: LoadSample,
    after: LoadSample,
  })
  .strict();
const Measurements = z
  .object({
    baseline: z.array(LoadTick).min(loadProtocol.baselineTicks),
    phases: z.array(Phase).length(3),
  })
  .strict();
const Entry = z
  .object({
    phase: z.union([z.literal(0), Population]),
    command: z.string().min(1),
    state: LoadSample,
  })
  .strict();
type Entry = z.infer<typeof Entry>;

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function counters(before: LoadSample, after: LoadSample) {
  const first = before.inference;
  const last = after.inference;
  if (first === undefined || last === undefined)
    throw new Error("native load trace has no inference metrics");
  if (
    InferenceMetrics.shape.inference
      .keyof()
      .options.some((key) => last[key] < first[key]) ||
    after.damage < before.damage ||
    after.damageEvents < before.damageEvents ||
    after.ages.some((age, index) => age < (before.ages[index] ?? 0))
  )
    throw new Error("native load trace has decreasing counters");
  if (last.deadlineMet + last.deadlineMissed > last.submitted)
    throw new Error("native load trace has impossible completion counters");
}

function ticks(
  population: number,
  measured: readonly LoadTick[],
  matches: readonly z.infer<typeof Match>[],
) {
  for (const [index, tick] of measured.entries()) {
    const previous = measured[index - 1];
    if (previous !== undefined && tick.serverTick !== previous.serverTick + 1)
      throw new Error("native load trace omitted or duplicated a server tick");
    if (
      tick.alive > population ||
      tick.observed > tick.alive ||
      tick.observed !== tick.applied + tick.unavailable + tick.ineligible
    )
      throw new Error("native load trace has inconsistent body accounting");
    if (tick.live && !matches.some((match) => match.match === tick.match))
      throw new Error("native load trace contains a foreign live match");
    if (population === 0 && (tick.live || tick.match !== ""))
      throw new Error("native load baseline is not an empty lobby");
  }
}

function log(raw: string) {
  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("native load command trace is empty");
  const entries = lines.map((line) => Entry.parse(JSON.parse(line)));
  const groups: Entry[][] = [];
  for (const entry of entries) {
    const group = groups.at(-1);
    if (group?.[0]?.phase === entry.phase) group.push(entry);
    else groups.push([entry]);
  }
  if (
    !equal(
      groups.map((group) => group[0]?.phase),
      [0, ...loadProtocol.counts],
    )
  )
    throw new Error(
      "native load command trace has repeated, omitted or reordered phases",
    );
  return groups;
}

function boundaries(group: readonly Entry[]) {
  const first = group[0];
  const last = group.at(-1);
  if (first === undefined || last === undefined)
    throw new Error("native load trace has an incomplete measurement window");
  if (
    first.command !== "window start" ||
    last.command !== "window stop" ||
    first.state.phase !== "LOBBY" ||
    first.state.match !== ""
  )
    throw new Error("native load trace has an incomplete measurement window");
  if (!inferenceDrained(first.state))
    throw new Error("native load measurement starts with pending requests");
  return { first, last };
}

function window(
  population: number,
  group: readonly Entry[],
  expectedSeed: number,
) {
  const { first, last } = boundaries(group);
  let previous = first.state;
  const matches: z.infer<typeof Match>[] = [];
  for (const [index, entry] of group.entries()) {
    if (!entry.state.ready || entry.state.bots > population)
      throw new Error(
        "native load trace contains an unready or oversized actor population",
      );
    counters(previous, entry.state);
    previous = entry.state;
    if (index === 0 || index === group.length - 1 || entry.command === "sample")
      continue;
    const seed = expectedSeed + matches.length;
    if (
      population === 0 ||
      entry.command !== `begin ${population.toString()} ${seed.toString()}` ||
      entry.state.seed !== seed ||
      entry.state.bots !== population ||
      entry.state.match === ""
    )
      throw new Error(
        "native load match differs from the original controller schedule",
      );
    matches.push({ seed, match: entry.state.match });
  }
  const measured = group.flatMap((entry) => entry.state.ticks);
  ticks(population, measured, matches);
  return { before: first.state, after: last.state, ticks: measured, matches };
}

/** Rebuild every window from the command stream; aggregate pass labels are unused. */
export function recomputeLoadEvidence(
  rawMeasurements: unknown,
  rawLog: string,
) {
  const measured = Measurements.parse(rawMeasurements);
  if (
    !equal(
      measured.phases.map((phase) => phase.bots),
      loadProtocol.counts,
    )
  )
    throw new Error("native load measurements have the wrong populations");
  const groups = log(rawLog);
  const baselineGroup = groups[0];
  if (baselineGroup === undefined)
    throw new Error("native load baseline is missing");
  const baseline = window(0, baselineGroup, 700_000_000);
  if (!equal(baseline.ticks, measured.baseline))
    throw new Error(
      "native load baseline differs from the full command stream",
    );
  let seed = 700_000_000;
  let previous = baseline.after;
  const identities = new Set<string>();
  const rows = measured.phases.map((phase, index) => {
    counters(previous, phase.before);
    previous = phase.after;
    const group = groups[index + 1];
    if (group === undefined)
      throw new Error("native load measurement window is missing");
    const reconstructed = window(phase.bots, group, seed);
    seed += reconstructed.matches.length;
    if (
      !equal(reconstructed, {
        before: phase.before,
        after: phase.after,
        ticks: phase.ticks,
        matches: phase.matches,
      })
    )
      throw new Error("native load phase differs from the full command stream");
    for (const match of phase.matches) {
      if (identities.has(match.match))
        throw new Error("native load phases reuse a match identity");
      identities.add(match.match);
    }
    return {
      ...loadSummary(phase.bots, phase.ticks, phase.before, phase.after),
      matches: phase.matches,
    };
  });
  const summary = {
    ticks: measured.baseline.length,
    p95: percentile(
      measured.baseline.map((tick) => tick.milliseconds),
      0.95,
    ),
  };
  return {
    baseline: summary,
    rows,
    pass:
      summary.p95 < loadProtocol.serverP95Milliseconds &&
      rows.every((row) => row.pass),
  };
}
