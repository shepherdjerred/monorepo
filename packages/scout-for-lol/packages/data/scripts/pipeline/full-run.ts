// The first full run: pass 1 with Sonnet (tips-4, batch and cache, the one
// retry) over the plan's whole unit list, most-played first; combos for the
// general sets (empty by default, validated, each one checked); Decisions
// triage of every tip, recording p(wrong) and hiding only a tip that is both
// very likely wrong (>= 0.85) and asserts an interaction. No escalation, no
// repair. Output: one JSON file per champion under src/tips/generated/champions
// with an index, the glossary, and a run report.
//
// Every chunk of units is checkpointed to .tips-cache/full-run/ before the
// next starts, and a rerun resumes after the last finished chunk. The whole
// run is held to --max-cost-usd (batches and Decisions together); after the
// first 10% of the units, and after every chunk, it stops and reports rather
// than trim quality if the projected total will not fit.
//
//   pipeline/full-run.ts --max-cost-usd 95 [--chunk 300] [--limit N] [--out <dir>]

import { mkdir, readdir, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { latestVersion } from "#src/data-dragon/version.ts";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { getChampionById } from "#src/model/riot/champion-registry.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  type FailedUnit,
  type StoredUnit,
  buildChampionFiles,
  buildIndex,
} from "#src/tips/output/champion-output.ts";
import {
  CHAMPION_TIPS_INDEX_PATH,
  championTipsPath,
} from "#src/tips/output/champion-tips.ts";
import { ComboSchema } from "#src/tips/combos/combo-schema.ts";
import { comboCites } from "#src/tips/combos/combos.ts";
import {
  CURRENT_GROUNDING_VERSION,
  computeTipInputHash,
} from "#src/tips/input-hash.ts";
import { GenerationBudget, TipBudgetExceededError } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { loadFactIndex } from "#src/tips/output/refs.ts";
import {
  CiteSchema,
  type GlossaryEntry,
  GlossaryEntrySchema,
  type GlossaryId,
} from "#src/tips/schema.ts";
import { ALL_TIPS, selectWork } from "#src/tips/select.ts";
import { createTipStore } from "#src/tips/store.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import { escalateCombos, generateCombos } from "./combos.ts";
import { createContext } from "./context.ts";
import { checkUnit } from "./draft.ts";
import { generatePass } from "./generate.ts";
import { type Context, Ledger, type UnitState, liveTips } from "./state.ts";
import { asksAboutInteraction, triage } from "./triage.ts";
import { loadUnit } from "./units.ts";

let GENERATED = `${import.meta.dir}/../../src/tips/generated`;
let CHECKPOINTS = `${import.meta.dir}/../../.tips-cache/full-run`;
let REPORT_PATH = `${EVAL_RAW_DIRECTORY}/full-run-report.json`;
/** A tip this likely wrong that also asserts an interaction is hidden; everything else ships. */
const HIDE_AT = 0.85;
/** Room kept under the cap for the Decisions API, which the batch budget does not see. */
const DECISIONS_ALLOWANCE_USD = 2;

const StoredUnitSchema = z.object({
  id: z.string(),
  lane: z.enum(["top", "jungle", "middle", "adc", "support"]),
  inputHash: z.string(),
  sets: z.array(
    z.object({
      subjectKey: z.string(),
      opponentKey: z.string().optional(),
      tips: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          cites: z.array(CiteSchema),
          pWrong: z.number(),
          hidden: z.boolean(),
        }),
      ),
      combos: z.array(
        z.object({ combo: ComboSchema, cites: z.array(CiteSchema) }),
      ),
    }),
  ),
});

const ChunkSchema = z.object({
  index: z.number().int(),
  unitIds: z.array(z.string()),
  stored: z.array(StoredUnitSchema),
  /** Units whose generation failed twice or whose champion has no facts. */
  failed: z.array(z.object({ unitId: z.string(), reason: z.string() })),
  glossary: z.array(GlossaryEntrySchema),
  spend: z.record(z.string(), z.object({ usd: z.number() })),
  stats: z.record(z.string(), z.record(z.string(), z.number())),
});
type Chunk = z.infer<typeof ChunkSchema>;

type PlannedUnit = { lane: Lane; championIds: number[]; games: number };

function plannedUnits(): PlannedUnit[] {
  const source = lanePriorTipPlanSource(currentLanePriors);
  const work = selectWork(planTips(source), source, ALL_TIPS);
  return [
    ...work.general.map((entry) => ({
      lane: entry.lane,
      championIds: [entry.championId as number],
      games: entry.games,
    })),
    ...work.matchups.map((unit) => ({
      lane: unit.lane,
      championIds: [...unit.championIds] as number[],
      games: unit.games,
    })),
  ].toSorted((left, right) => right.games - left.games);
}

const prettierJson = async (path: string, value: unknown): Promise<string> => {
  const config = await resolveConfig(path);
  return format(JSON.stringify(value), {
    ...config,
    parser: "json",
    filepath: path,
  });
};

async function readChunks(): Promise<Chunk[]> {
  const names = await readdir(CHECKPOINTS).catch(() => []);
  const chunks: Chunk[] = [];
  for (const name of names
    .filter((entry) => entry.endsWith(".json"))
    .toSorted()) {
    chunks.push(
      ChunkSchema.parse(await Bun.file(`${CHECKPOINTS}/${name}`).json()),
    );
  }
  return chunks;
}

/** What a unit kept, with the validators' own cites and the Decisions score of every tip. */
function toStored(ctx: Context, unit: UnitState): StoredUnit | undefined {
  const checked = checkUnit(ctx, unit);
  const result = checked.result;
  if (result === undefined) {
    return undefined;
  }
  const normalised =
    "set" in result
      ? [result.set.tips]
      : [result.forward.tips, result.reverse.tips];
  const sets: StoredUnit["sets"] = [];
  for (const [index, set] of unit.sets.entries()) {
    const tips = liveTips(set);
    const cited = normalised[index] ?? [];
    if (cited.length !== tips.length) {
      throw new Error(
        `unit ${unit.id} lost tips between the draft and its check`,
      );
    }
    sets.push({
      subjectKey: set.subject.key,
      opponentKey: set.opponent?.key,
      tips: tips.map((tip, position) => {
        const pWrong = tip.decision?.pWrong ?? 0;
        return {
          id: `${unit.lane}:${set.subject.key}:${set.opponent?.key ?? "general"}:${position.toString()}`,
          text: tip.text,
          cites: cited[position]?.cites ?? [],
          pWrong,
          hidden: pWrong >= HIDE_AT && asksAboutInteraction(tip.text),
        };
      }),
      combos: set.combos
        .filter((entry) => entry.status === "live")
        .map((entry, position) => ({
          // The id a page sees: stable by lane, champion and position, with no model prefix.
          combo: {
            ...entry.combo,
            id: `${unit.lane}:${set.subject.key}:combo:${position.toString()}`,
          },
          cites: comboCites(entry.combo, set.subject),
        })),
    });
  }
  const first = unit.groundings[0];
  const second = unit.groundings[1];
  if (first === undefined) {
    throw new Error("a unit has no champion");
  }
  return {
    id: unit.id,
    lane: unit.lane,
    inputHash: computeTipInputHash(
      TIP_PROMPT_VERSION,
      second === undefined
        ? { kind: "general", lane: unit.lane, championIds: [first.championId] }
        : {
            kind: "matchup",
            lane: unit.lane,
            championIds: [first.championId, second.championId],
          },
      unit.groundings,
      { wiki: unit.pages, groundingVersion: CURRENT_GROUNDING_VERSION },
    ),
    sets,
  };
}

async function writeOutputs(
  stored: readonly StoredUnit[],
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>,
  meta: { patch: string; model: string; promptVersion: string },
): Promise<{ failed: FailedUnit[]; bytes: number; champions: number }> {
  const index = await loadFactIndex([...glossary.keys()]);
  const { files, failed } = buildChampionFiles(stored, meta, {
    index,
    glossary,
    championKeyOf: (id) => getChampionById(ChampionIdSchema.parse(id))?.key,
  });
  const bytes = new Map<string, number>();
  await mkdir(`${GENERATED}/champions`, { recursive: true });
  for (const [key, file] of files) {
    const text = await prettierJson(
      `${GENERATED}/${championTipsPath(key)}`,
      file,
    );
    await Bun.write(`${GENERATED}/${championTipsPath(key)}`, text);
    bytes.set(key, new TextEncoder().encode(text).length);
  }
  for (const name of await readdir(`${GENERATED}/champions`)) {
    if (!files.has(name.replace(/\.json$/u, ""))) {
      await rm(`${GENERATED}/champions/${name}`);
    }
  }
  await Bun.write(
    `${GENERATED}/${CHAMPION_TIPS_INDEX_PATH}`,
    await prettierJson(
      `${GENERATED}/${CHAMPION_TIPS_INDEX_PATH}`,
      buildIndex(files, bytes, meta),
    ),
  );
  return {
    failed,
    bytes: [...bytes.values()].reduce((sum, value) => sum + value, 0),
    champions: files.size,
  };
}

const mean = (sets: readonly { tips: readonly unknown[] }[]): number =>
  sets.reduce((sum, set) => sum + set.tips.length, 0) /
  Math.max(1, sets.length);

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      chunk: { type: "string", default: "300" },
      limit: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  if (values.out !== undefined) {
    // A trial run: its output, checkpoints and report stay under one directory.
    GENERATED = values.out;
    CHECKPOINTS = `${values.out}/.checkpoints`;
    REPORT_PATH = `${values.out}/run-report.json`;
  }
  const cap = Number(values["max-cost-usd"]);
  const chunkSize = Number(values.chunk);
  const all = plannedUnits();
  const planned =
    values.limit === undefined ? all : all.slice(0, Number(values.limit));
  console.log(
    `${planned.length.toString()} units planned (${all.length.toString()} in the plan)`,
  );

  const prior = await readChunks();
  const done = new Set(prior.flatMap((chunk) => chunk.unitIds));
  const stored: StoredUnit[] = prior.flatMap((chunk) => chunk.stored);
  const failedGeneration = prior.flatMap((chunk) => chunk.failed);
  const spend = new Map<string, number>();
  const stats = new Map<string, Record<string, number>>();
  for (const chunk of prior) {
    for (const [pass, entry] of Object.entries(chunk.spend)) {
      spend.set(pass, (spend.get(pass) ?? 0) + entry.usd);
    }
  }
  const total = (): number =>
    [...spend.values()].reduce((sum, value) => sum + value, 0);

  const glossaryStore = createTipStore({
    directory: GENERATED,
    format: prettierJson,
  });
  const known = new Map(await glossaryStore.glossary());
  for (const chunk of prior) {
    for (const entry of chunk.glossary) {
      if (!known.has(entry.id)) {
        known.set(entry.id, entry);
      }
    }
  }
  const ctx = await createContext({
    maxCostUsd: Math.max(0.5, cap - total()),
    maxSearches: 0,
    maxFillPasses: 0,
  });
  ctx.glossary = known;
  ctx.env.glossary = known;
  const meta = {
    patch: latestVersion,
    model: ctx.generator,
    promptVersion: TIP_PROMPT_VERSION,
  };
  const started = Date.now();
  let chunkIndex = prior.length;
  let stopReason: string | undefined;

  for (
    let from = 0;
    from < planned.length && stopReason === undefined;
    from += chunkSize
  ) {
    const slice = planned.slice(from, from + chunkSize);
    const units: UnitState[] = [];
    const failed: Chunk["failed"] = [];
    const ids: string[] = [];
    for (const unit of slice) {
      try {
        const loaded = await loadUnit({
          wiki: ctx.wiki,
          lane: unit.lane,
          championIds: unit.championIds.map((id) => ChampionIdSchema.parse(id)),
          model: ctx.generator,
          earlier: [],
        });
        ids.push(loaded.id);
        if (!done.has(loaded.id)) {
          units.push(loaded);
        }
      } catch (error: unknown) {
        failed.push({
          unitId: `${unit.lane}:${unit.championIds.join("-")}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (units.length === 0) {
      continue;
    }
    ctx.budget = new GenerationBudget(
      Math.max(0.5, cap - total() - DECISIONS_ALLOWANCE_USD),
    );
    ctx.ledger = new Ledger();
    console.log(
      `chunk ${(chunkIndex + 1).toString()}: ${units.length.toString()} units, $${total().toFixed(2)} spent`,
    );
    try {
      await generatePass(ctx, units);
      const working = units.filter((unit) => unit.origin !== "failed");
      for (const unit of units.filter((entry) => entry.origin === "failed")) {
        failed.push({
          unitId: unit.id,
          reason: "generation failed after the retry",
        });
      }
      const generals = working.filter((unit) => unit.groundings.length === 1);
      await generateCombos(ctx, generals);
      await escalateCombos(ctx, generals);
      await triage(ctx, working, "triage");
      const results = working.flatMap((unit) => {
        const result = toStored(ctx, unit);
        return result === undefined ? [] : [result];
      });
      // Several units may propose the same keyword; the first one wins, and
      // an id the glossary already has is not added again.
      const proposed = new Map<GlossaryId, GlossaryEntry>();
      for (const unit of working) {
        for (const entry of checkUnit(ctx, unit).result?.glossaryAdditions ??
          []) {
          if (!known.has(entry.id) && !proposed.has(entry.id)) {
            proposed.set(entry.id, entry);
          }
        }
      }
      const additions = [...proposed.values()];
      const chunk: Chunk = {
        index: chunkIndex,
        unitIds: ids,
        stored: results,
        failed,
        glossary: additions,
        spend: Object.fromEntries(
          [...ctx.ledger.spend].map(([pass, entry]) => [
            pass,
            { usd: entry.usd },
          ]),
        ),
        stats: Object.fromEntries(ctx.ledger.stats),
      };
      await mkdir(CHECKPOINTS, { recursive: true });
      await Bun.write(
        `${CHECKPOINTS}/chunk-${chunkIndex.toString().padStart(3, "0")}.json`,
        JSON.stringify(chunk),
      );
      chunkIndex += 1;
      for (const id of ids) {
        done.add(id);
      }
      stored.push(...results);
      failedGeneration.push(...failed);
      for (const [pass, entry] of ctx.ledger.spend) {
        spend.set(pass, (spend.get(pass) ?? 0) + entry.usd);
      }
      for (const [pass, entry] of ctx.ledger.stats) {
        const merged = stats.get(pass) ?? {};
        for (const [key, value] of Object.entries(entry)) {
          merged[key] = (merged[key] ?? 0) + value;
        }
        stats.set(pass, merged);
      }
      for (const entry of additions) {
        if (!known.has(entry.id)) {
          known.set(entry.id, entry);
        }
      }
      ctx.glossary = new Map(known);
      ctx.env.glossary = ctx.glossary;
      await glossaryStore.addGlossaryEntries(additions);
      await glossaryStore.flush();
      await writeOutputs(stored, known, meta);
    } catch (error: unknown) {
      if (error instanceof TipBudgetExceededError) {
        stopReason = `the budget has no room for the next chunk: ${error.message}`;
        break;
      }
      throw error;
    }
    const unitsDone = done.size;
    const projected = (total() / Math.max(1, unitsDone)) * planned.length;
    console.log(
      `${unitsDone.toString()} of ${planned.length.toString()} units, $${total().toFixed(2)} spent, projected $${projected.toFixed(2)}`,
    );
    if (unitsDone >= planned.length * 0.1 && projected > cap) {
      stopReason = `projected spend $${projected.toFixed(2)} will not fit under $${cap.toString()} after ${unitsDone.toString()} units`;
    }
  }

  const output = await writeOutputs(stored, known, meta);
  const tips = stored.flatMap((unit) => unit.sets.flatMap((set) => set.tips));
  const sets = stored.flatMap((unit) => unit.sets);
  const report = {
    generatedAt: new Date().toISOString(),
    model: ctx.generator,
    promptVersion: TIP_PROMPT_VERSION,
    capUsd: cap,
    stopReason: stopReason ?? null,
    unitsPlanned: planned.length,
    unitsDone: done.size,
    unitsStored: stored.length,
    unitsFailedGeneration: failedGeneration.length,
    unitsFailedReferences: output.failed.length,
    failedReferenceExamples: output.failed.slice(0, 10),
    spentUsd: total(),
    spendByStage: Object.fromEntries(spend),
    seconds: Math.round((Date.now() - started) / 1000),
    sets: sets.length,
    tips: tips.length,
    tipsPerSet: tips.length / Math.max(1, sets.length),
    tipsPerGeneralSet: mean(
      sets.filter((set) => set.opponentKey === undefined),
    ),
    tipsPerMatchupSide: mean(
      sets.filter((set) => set.opponentKey !== undefined),
    ),
    hiddenTips: tips.filter((tip) => tip.hidden).length,
    combos: sets.reduce((sum, set) => sum + set.combos.length, 0),
    glossaryEntries: known.size,
    championFiles: output.champions,
    outputBytes: output.bytes,
    stats: Object.fromEntries(stats),
  };
  await Bun.write(REPORT_PATH, await prettierJson(REPORT_PATH, report));
  console.log(JSON.stringify(report, null, 2));
  if (stopReason !== undefined) {
    console.log(`STOPPED: ${stopReason}`);
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  await main();
}
