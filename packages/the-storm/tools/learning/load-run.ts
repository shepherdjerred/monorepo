import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { frozenManifest, openPaperDuels, root } from "./sandbox.ts";
import type { LoadSample, LoadTick } from "./load-client.ts";
import { loadProtocol, loadSummary, percentile } from "./load-gate.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const digest = async (file: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(file).arrayBuffer())
    .digest("hex");

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
    artifacts: {
      manifest: await digest(path.join(model, "manifest.json")),
      actor: await digest(path.join(model, "actor.onnx")),
    },
    protocol: loadProtocol,
    acceptance: "unaccepted",
    pilotAcceptanceChecked: false,
    learnedControlEnabled: false,
  };
}

const manifest: unknown = await Bun.file(
  path.join(model, "manifest.json"),
).json();
const checked = z
  .object({
    schema: z.literal(1),
    kind: z.literal("rwf-trooper-ppo"),
    acceptance: z.literal("unaccepted"),
    onnx_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .parse(manifest);
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
  while (state.phase !== "LOBBY") {
    await Bun.sleep(100);
    state = await paper.load.command("sample");
    if (Date.now() > deadline)
      throw new Error("native load cleanup did not reach an empty lobby");
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
const rows = phases.map(({ bots, ticks, before, after, matches }) => ({
  ...loadSummary(bots, ticks, before, after),
  matches,
}));
const report = {
  ...frozen,
  baseline: {
    ticks: baseline.length,
    p95: percentile(
      baseline.map((tick) => tick.milliseconds),
      0.95,
    ),
  },
  rows,
  pass: rows.every((row) => row.pass),
};
await Bun.write(
  path.join(output, "verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.warn(JSON.stringify({ pass: report.pass, rows }));
if (!report.pass)
  throw new Error(
    "native inference load failed frozen acceptance bars; all windows retained",
  );
