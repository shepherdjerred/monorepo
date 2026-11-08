import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, rename, rmdir } from "node:fs/promises";
import { z } from "zod";
import { SuiteRunSchema } from "@shepherdjerred/mc-harness/capture/suite/archive.ts";
import suite from "./suite.ts";
import { MC_DIR } from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { awsStore } from "@shepherdjerred/mc-harness/capture/suite/aws-store.ts";
import {
  retainBlob,
  cachedBlob,
} from "@shepherdjerred/mc-harness/capture/suite/store.ts";
import {
  campaignPlan,
  executeCampaign,
  replayCampaign,
  validateCampaign,
  validatePlan,
  type Campaign,
} from "@shepherdjerred/mc-harness/capture/campaign/state.ts";

const { values } = parseArgs({
  options: {
    fixture: { type: "string" },
    resume: { type: "string" },
    replay: { type: "string" },
    fresh: { type: "boolean" },
  },
});
const root = path.resolve(import.meta.dirname, "../../../..");
const directory = path.join(MC_DIR, "campaigns");
const store = awsStore("the-storm-capture-fixtures");
const cache = path.join(MC_DIR, "suite-blobs");
if (
  [values.fixture, values.resume, values.replay].filter((v) => v !== undefined)
    .length !== 1 ||
  (values.fresh === true && values.replay === undefined)
)
  throw new Error(
    "Choose --fixture SHA256, --resume UUID, or --replay UUID [--fresh]",
  );
async function saved(id: string) {
  z.uuid().parse(id);
  const pointer = z
    .strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/u) })
    .parse(
      JSON.parse(
        new TextDecoder().decode(await store.read(`campaigns/${id}.json`)),
      ),
    );
  const state = validateCampaign(
    await Bun.file(await cachedBlob(store, cache, pointer.sha256)).json(),
  );
  if (state.id !== id || state.batches.some((b) => b.run === null))
    throw new Error("Retained campaign identity or completion differs");
  return state;
}
async function initial(): Promise<Campaign> {
  if (values.resume !== undefined) {
    const id = z.uuid().parse(values.resume);
    const state = validateCampaign(
      await Bun.file(path.join(directory, `${id}.json`)).json(),
    );
    if (state.id !== id) throw new Error("Checkpoint identity differs");
    return state;
  }
  if (values.replay !== undefined)
    return replayCampaign(await saved(values.replay), values.fresh === true);
  return validateCampaign({
    schema: 1,
    id: crypto.randomUUID(),
    suite: suite.id,
    fixture: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(values.fixture),
    runtime: null,
    replay: null,
    scope: "all",
    batches: campaignPlan(suite),
  });
}
async function persist(next: Campaign) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${next.id}.json`),
    temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
async function run(state: Campaign) {
  validatePlan(state, suite);
  await persist(state);
  console.error(
    JSON.stringify({
      campaign: state.id,
      checkpoint: path.join(directory, `${state.id}.json`),
    }),
  );
  const complete = await executeCampaign(
    state,
    persist,
    async (part, baseline) => {
      const args =
        part.replayOf === null
          ? [
              "run",
              "tsmc",
              "--runtime",
              baseline === undefined ? "worktree" : `saved:${baseline}`,
              "--fixture",
              state.fixture,
              "--scenario",
              part.ids.join(","),
            ]
          : ["replay", part.replayOf];
      console.error(
        JSON.stringify({ batch: part.ids, replayOf: part.replayOf }),
      );
      const child = Bun.spawn(["toolkit", "mc", "capture", "suite", ...args], {
        cwd: root,
        env: {
          ...Bun.env,
          OP_SERVICE_ACCOUNT_TOKEN: undefined,
          MC_BRIDGE_TOKEN: undefined,
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [output, code] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      if (code !== 0)
        throw new Error(
          `Batch failed (${code.toString()}); resume with --resume ${state.id}`,
        );
      return SuiteRunSchema.parse(JSON.parse(output.trim()));
    },
  );
  const hash = await retainBlob(
    store,
    new TextEncoder().encode(JSON.stringify(complete)),
  );
  const pointer = new TextEncoder().encode(JSON.stringify({ sha256: hash }));
  await store.write(`campaigns/${complete.id}.json`, pointer);
  if (
    new TextDecoder().decode(
      await store.read(`campaigns/${complete.id}.json`),
    ) !== new TextDecoder().decode(pointer)
  )
    throw new Error("Campaign index readback differs");
  process.stdout.write(JSON.stringify(complete) + "\n");
}
const first = await initial();
await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = path.join(directory, `${first.id}.lock`);
try {
  await mkdir(lock, { mode: 0o700 });
} catch (error) {
  throw new Error(
    `Cannot acquire campaign lock ${lock}; confirm the previous runner has stopped before removing a stale lock`,
    { cause: error },
  );
}
try {
  // A concurrent process may have completed a batch while this process loaded the checkpoint.
  await run(values.resume === undefined ? first : await initial());
} finally {
  await rmdir(lock);
}
