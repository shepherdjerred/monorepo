import { LoadSample, type LoadTick } from "#learning/load-client.ts";

/** Synthetic command/tick accounting only; this is never gameplay or quality evidence. */
export function loadFixture() {
  let serverTick = 1;
  let submitted = 0;
  let roster = 0;
  let match = "";
  let seed = 0;
  let live = false;
  const entries: { phase: number; command: string; state: LoadSample }[] = [];
  const phases: {
    bots: number;
    ticks: LoadTick[];
    matches: { seed: number; match: string }[];
    before: LoadSample;
    after: LoadSample;
  }[] = [];
  const sample = (ticks: LoadTick[]) =>
    LoadSample.parse({
      protocol: 1,
      contract: "rwf-inference-load-v1",
      ready: true,
      result: live ? "live" : "idle",
      phase: live ? "LIVE" : match === "" ? "LOBBY" : "COUNTDOWN",
      match,
      seed,
      bots: roster,
      ticks,
      ages: [0, submitted, 0],
      damageEvents: Math.floor(submitted / 100),
      damage: submitted / 100,
      inference: {
        submitted,
        skipped: 0,
        timely: submitted,
        stale: 0,
        expired: 0,
        contextDrops: 0,
        deadlineMet: submitted,
        deadlineMissed: 0,
        resets: 0,
        rejected: 0,
        hits: submitted,
        misses: 0,
        maximumNanos: submitted === 0 ? 0 : 1_000_000,
        maximumBatch: roster,
      },
    });
  const entry = (phase: number, command: string, ticks: LoadTick[] = []) => {
    const state = sample(ticks);
    entries.push({ phase, command, state });
    return state;
  };
  const measured = (count: number) =>
    Array.from({ length: count }, (): LoadTick => ({
      serverTick: serverTick++,
      milliseconds: 5,
      match,
      botTick: live ? serverTick : 0,
      alive: live ? roster : 0,
      observed: live ? roster : 0,
      applied: live ? roster : 0,
      unavailable: 0,
      ineligible: 0,
      live,
    }));
  entry(0, "window start");
  const baseline = entry(0, "sample", measured(1800)).ticks;
  entry(0, "window stop");
  for (const [index, bots] of [20, 50, 100].entries()) {
    live = false;
    match = "";
    const before = entry(bots, "window start");
    roster = bots;
    seed = 700_000_000 + index;
    match = `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`;
    entry(bots, `begin ${bots.toString()} ${seed.toString()}`);
    live = true;
    const ticks: LoadTick[] = [];
    for (let chunk = 0; chunk < 2; chunk++) {
      const added = measured(1500);
      submitted += added.length * roster;
      ticks.push(...entry(bots, "sample", added).ticks);
    }
    const after = entry(bots, "window stop");
    phases.push({ bots, ticks, matches: [{ seed, match }], before, after });
  }
  return {
    measurements: { baseline, phases },
    entries,
    log: () =>
      entries.map((record) => JSON.stringify(record)).join("\n") + "\n",
  };
}
