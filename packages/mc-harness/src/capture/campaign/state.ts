import { z } from "zod";
import { SuiteRunSchema } from "#src/capture/suite/archive.ts";
import type { CaptureSuite } from "#src/capture/suite/define.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const batch = z.strictObject({
  ids: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/u)).min(1),
  fresh: z.boolean(),
  replayOf: z.uuid().nullable(),
  run: SuiteRunSchema.nullable(),
});
export const CampaignSchema = z.strictObject({
  schema: z.literal(1),
  id: z.uuid(),
  suite: z.string(),
  fixture: hash,
  runtime: hash.nullable(),
  replay: z.uuid().nullable(),
  scope: z.enum(["all", "fresh"]),
  batches: z.array(batch).min(1),
});
export type Campaign = z.infer<typeof CampaignSchema>;
export type Batch = Campaign["batches"][number];

function validateBatch(state: Campaign, part: Batch) {
  if ((part.replayOf === null) !== (state.replay === null))
    throw new Error("Campaign mixes capture and replay batches");
  if (state.scope === "fresh" && !part.fresh)
    throw new Error("Fresh replay contains a shared batch");
  if (part.fresh && part.ids.length !== 1)
    throw new Error("Fresh batch contains multiple scenarios");
}

/** Bound lost work while keeping related mechanics in a common session. */
export function campaignPlan(suite: CaptureSuite): Batch[] {
  const shared = suite.scenarios.filter((s) => s.isolation !== "fresh");
  const batches: Batch[] = [];
  for (let index = 0; index < shared.length; index += 4)
    batches.push({
      ids: shared.slice(index, index + 4).map((s) => s.id),
      fresh: false,
      replayOf: null,
      run: null,
    });
  return [
    ...batches,
    ...suite.scenarios
      .filter((s) => s.isolation === "fresh")
      .map((s) => ({
        ids: [s.id],
        fresh: true,
        replayOf: null,
        run: null,
      })),
  ];
}

export function validateCampaign(value: unknown): Campaign {
  const state = CampaignSchema.parse(value);
  const ids = state.batches.flatMap((b) => b.ids);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate campaign scenario");
  let unfinished = false;
  if (state.scope === "fresh" && state.replay === null)
    throw new Error("Fresh selection is only supported for saved replay");
  for (const part of state.batches) {
    validateBatch(state, part);
    if (part.run === null) {
      unfinished = true;
      continue;
    }
    if (unfinished)
      throw new Error("Campaign checkpoints must form a completed prefix");
    if (state.runtime === null)
      throw new Error("Completed checkpoints need a pinned runtime");
    validateResult(state, part, part.run);
  }
  if (state.replay !== null && state.runtime === null)
    throw new Error("Replay needs a pinned runtime");
  return state;
}

function validateResult(
  state: Campaign,
  part: Batch,
  result: z.infer<typeof SuiteRunSchema>,
) {
  if (
    result.suite !== state.suite ||
    result.fixture !== state.fixture ||
    (state.runtime !== null && result.runtime !== state.runtime) ||
    result.selection.shot !== undefined ||
    result.selection.scenario !== part.ids.join(",") ||
    JSON.stringify(result.scenarios.map((s) => s.id)) !==
      JSON.stringify(part.ids)
  )
    throw new Error(
      "Batch differs from the campaign's immutable inputs or declared scenarios",
    );
}

/** Persist only complete, retained native runs; a failed batch remains pending on resume. */
export async function executeCampaign(
  input: Campaign,
  persist: (state: Campaign) => Promise<void>,
  invoke: (part: Batch, baseline: string | undefined) => Promise<unknown>,
): Promise<Campaign> {
  let state = validateCampaign(input);
  for (const [index, part] of state.batches.entries()) {
    if (part.run !== null) continue;
    const baseline = state.batches.find((b) => b.run !== null)?.run?.id;
    const result = SuiteRunSchema.parse(await invoke(part, baseline));
    validateResult(state, part, result);
    const batches = state.batches.map((b, i) =>
      i === index ? { ...b, run: result } : b,
    );
    const next = validateCampaign({
      ...state,
      runtime: result.runtime,
      batches,
    });
    await persist(next);
    state = next;
  }
  return state;
}

export function replayCampaign(input: Campaign, fresh: boolean): Campaign {
  const previous = validateCampaign(input);
  if (previous.batches.some((b) => b.run === null))
    throw new Error("Replay needs a complete campaign");
  return validateCampaign({
    ...previous,
    id: crypto.randomUUID(),
    replay: previous.id,
    scope: fresh ? "fresh" : previous.scope,
    batches: previous.batches
      .filter((b) => !fresh || b.fresh)
      .map((b) => ({
        ...b,
        replayOf: requiredRun(b).id,
        run: null,
      })),
  });
}

function requiredRun(part: Batch) {
  if (part.run === null) throw new Error("Missing retained batch");
  return part.run;
}

/** Refuse a resume against edited recipes; start a new campaign for new source. */
export function validatePlan(state: Campaign, suite: CaptureSuite): void {
  const expected = campaignPlan(suite).filter(
    (b) => state.scope !== "fresh" || b.fresh,
  );
  if (
    state.suite !== suite.id ||
    JSON.stringify(identity(state.batches)) !==
      JSON.stringify(identity(expected))
  )
    throw new Error(
      "Campaign plan differs from the declared suite; start a new campaign for changed recipes",
    );
}

function identity(parts: Batch[]) {
  return parts.map(({ ids, fresh }) => ({ ids, fresh }));
}
