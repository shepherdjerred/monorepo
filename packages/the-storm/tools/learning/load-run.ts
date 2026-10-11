import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { diagnosticPaths } from "#learning/native/diagnostics/options.ts";
import { frozenManifest, openPaperDuels, root } from "./sandbox.ts";
import type { LoadSample, LoadTick } from "./load-client.ts";
import {
  inferenceDrained,
  loadProtocol,
  loadSummary,
  percentile,
} from "./load-gate.ts";
import { recomputeLoadEvidence } from "./promotion/load-evidence.ts";
import {
  actorHashes,
  diagnosticManifest,
} from "#learning/native/diagnostics/actor.ts";
import { digestFile as digest } from "./preference/ledger.ts";

const { model, output } = diagnosticPaths();

async function inputs() {
  const owned = path.join(root, "server/owned");
  const listing = await readdir(owned, {
    recursive: true,
    withFileTypes: true,
  });
  const files = listing
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  files.push(
    path.join(root, "package.json"),
    path.join(root, "../../bun.lock"),
    path.join(root, "tests/e2e/harness/fake-brain.ts"),
    path.join(root, "tests/e2e/gameplay-fixtures.ts"),
    path.join(root, "tests/e2e/harness/server.ts"),
    path.join(root, "tests/e2e/harness/config-overlays.ts"),
    path.join(root, "tests/e2e/harness/rwf-settings.ts"),
    path.join(
      root,
      "plugin/modules/companions/build/libs/TheStormCompanionsE2E.jar",
    ),
  );
  return {
    native: await frozenManifest(),
    loadSources: await Promise.all(
      files.sort().map(async (file) => ({
        file: path.relative(root, file),
        sha256: await digest(file),
      })),
    ),
    artifacts: await actorHashes(model),
    protocol: loadProtocol,
    acceptance: "unaccepted",
    pilotAcceptanceChecked: false,
    learnedControlEnabled: false,
  };
}

const checked = await diagnosticManifest(model);
const frozen = await inputs();
if (checked.onnx_sha256 !== frozen.artifacts.actor)
  throw new Error("load actor digest differs");
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
await Bun.write(
  path.join(output, "inputs.json"),
  JSON.stringify(frozen, null, 2) + "\n",
);

const paper = await openPaperDuels(output, model, "load");
const raw = Bun.file(path.join(output, "samples.jsonl")).writer();
const phases: {
  bots: number;
  ticks: LoadTick[];
  matches: { seed: number; match: string }[];
  before: LoadSample;
  after: LoadSample;
}[] = [];
const baseline: LoadTick[] = [];
let seed = 700_000_000;
let phase = 0;

async function command(instruction: string, ticks: LoadTick[]) {
  const state = await paper.load.command(instruction);
  await raw.write(
    JSON.stringify({ phase, command: instruction, state }) + "\n",
  );
  await raw.flush();
  ticks.push(...state.ticks);
  return state;
}

async function sample(ticks: LoadTick[]) {
  await Bun.sleep(250);
  return command("sample", ticks);
}

function validateTicks(ticks: readonly LoadTick[]) {
  for (let index = 1; index < ticks.length; index++) {
    const previous = ticks[index - 1];
    const current = ticks[index];
    if (
      previous === undefined ||
      current?.serverTick !== previous.serverTick + 1
    )
      throw new Error("native tick sampler lost or duplicated a server tick");
  }
}

async function arm(
  bots: number,
  ticks: LoadTick[],
  matches: { seed: number; match: string }[],
) {
  if (matches.length >= loadProtocol.maxMatches)
    throw new Error(
      "full-roster load coverage exceeded the frozen match budget",
    );
  const state = await command(
    `begin ${bots.toString()} ${(seed++).toString()}`,
    ticks,
  );
  if (state.bots !== bots || state.match === "")
    throw new Error("native load match identity differs");
  matches.push({ seed: state.seed, match: state.match });
  return state;
}

function coverage(
  bots: number,
  ticks: LoadTick[],
  matches: { match: string }[],
) {
  const live = ticks.filter((tick) => tick.live);
  if (live.some((tick) => !matches.some((match) => match.match === tick.match)))
    throw new Error("foreign match reached native load samples");
  return {
    live: live.length,
    full: live.filter((tick) => tick.alive === bots && tick.observed === bots)
      .length,
  };
}

async function clearMatch(deadline: number) {
  let state = await paper.load.command("cancel");
  while (state.phase !== "LOBBY" || !inferenceDrained(state)) {
    await Bun.sleep(100);
    state = await paper.load.command("sample");
    if (Date.now() > deadline)
      throw new Error(
        "native load cleanup did not reach an empty lobby with drained inference",
      );
  }
}

async function runPhase(bots: number) {
  phase = bots;
  const ticks: LoadTick[] = [];
  const matches: { seed: number; match: string }[] = [];
  const before = await command("window start", ticks);
  let state = before;
  let liveTicks = 0;
  let fullTicks = 0;
  const deadline = Date.now() + loadProtocol.phaseDeadlineMs;
  while (
    liveTicks < loadProtocol.liveTicks ||
    fullTicks < loadProtocol.fullRosterTicks
  ) {
    if (Date.now() > deadline)
      throw new Error(`native ${bots.toString()}-body load phase timed out`);
    if (state.phase === "LOBBY") {
      await arm(bots, ticks, matches);
    }
    const previous = ticks.length;
    state = await sample(ticks);
    const added = coverage(bots, ticks.slice(previous), matches);
    liveTicks += added.live;
    fullTicks += added.full;
  }
  // Final pending requests count against the deadline gate; no selective
  // draining, exclusion of deaths, or extra work after seeing the results.
  const after = await command("window stop", ticks);
  validateTicks(ticks);
  phases.push({ bots, ticks, matches, before, after });
  await Bun.write(
    path.join(output, "phases.json"),
    JSON.stringify({ baseline, phases }, null, 2) + "\n",
  );
  console.warn(JSON.stringify(loadSummary(bots, ticks, before, after)));
  await clearMatch(deadline);
}

try {
  await paper.load.load();
  await command("window start", baseline);
  const baselineDeadline = Date.now() + loadProtocol.phaseDeadlineMs;
  while (baseline.length < loadProtocol.baselineTicks) {
    if (Date.now() > baselineDeadline)
      throw new Error("native load baseline timed out");
    await sample(baseline);
  }
  await command("window stop", baseline);
  validateTicks(baseline);
  console.warn(
    JSON.stringify({
      baselineTicks: baseline.length,
      p95: percentile(
        baseline.map((tick) => tick.milliseconds),
        0.95,
      ),
    }),
  );
  for (const bots of loadProtocol.counts) await runPhase(bots);
} finally {
  try {
    await raw.end();
  } finally {
    await paper.stop();
  }
}
if (JSON.stringify(await inputs()) !== JSON.stringify(frozen))
  throw new Error("native load inputs changed during measurement");
const verified = recomputeLoadEvidence(
  { baseline, phases },
  await Bun.file(path.join(output, "samples.jsonl")).text(),
);
const report = {
  ...frozen,
  ...verified,
};
await Bun.write(
  path.join(output, "verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.warn(JSON.stringify({ pass: report.pass, rows: verified.rows }));
if (!report.pass)
  throw new Error(
    "native inference load failed frozen acceptance bars; all windows retained",
  );
