// A refs-only pass over the first full run's output: each matchup side whose
// champion has combos in that lane may point at up to 3 of them, with a
// one-line note on why the combo works or fails against this opponent. The
// model only chooses from the champion's existing combos (an empty list is the
// expected answer), one batch job per pair (both sides together), Sonnet, batch
// and cache, held to --max-cost-usd and checkpointed per chunk. It stops and
// reports rather than overspend when the projection will not fit.
//
//   pipeline/refs-only.ts --max-cost-usd 6 [--chunk 240] [--limit N]

import { mkdir, readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { latestVersion } from "#src/data-dragon/version.ts";
import { getChampionByKey } from "#src/model/riot/champion-registry.ts";
import { comboCites, validateComboRefs } from "#src/tips/combos/combos.ts";
import type {
  StoredComboRef,
  StoredUnit,
} from "#src/tips/output/champion-output.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { GenerationBudget, TipBudgetExceededError } from "#src/tips/model.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { createTipStore } from "#src/tips/store.ts";
import { addMissingAbilityCites, validateTip } from "#src/tips/validate.ts";
import type { BatchJob } from "../tips-batch.ts";
import { describeCombo } from "./combos.ts";
import { createContext } from "./context.ts";
import { runJobs } from "./draft.ts";
import {
  REFS_CHECKPOINTS,
  applyRefs,
  readChunks,
  writeOutputs,
} from "./full-run.ts";

const GENERATED = `${import.meta.dir}/../../src/tips/generated`;
const MAX_REFS = 3;

const SYSTEM = `You connect a champion's listed combos to one matchup in League of Legends. For each side you are given, you get that champion's combos (each with an id) and the opponent's abilities. Pick up to ${MAX_REFS.toString()} of the champion's combos that matter against this opponent, because they work well against it or fail against it, and write a one-line note on why: one plain sentence of at most 100 characters.

Use only the listed ids and say only what follows from the combo and from the opponent's listed abilities; never invent an effect. An empty list is the expected answer when no combo clearly matters. No statistics. Name an ability only when it is a step of that combo or one of the opponent's listed abilities.`;

const RefsAnswerSchema = z.object({
  forward: z.array(z.object({ comboId: z.string(), note: z.string() })),
  reverse: z.array(z.object({ comboId: z.string(), note: z.string() })),
});

type SideRefs = { subjectKey: string; comboRefs: StoredComboRef[] };

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      chunk: { type: "string", default: "240" },
      limit: { type: "string" },
    },
    strict: true,
  });
  const cap = Number(values["max-cost-usd"]);
  const chunkSize = Number(values.chunk);
  const stored: StoredUnit[] = (await readChunks()).flatMap(
    (chunk) => chunk.stored,
  );

  // Each champion's combos by lane, from the general sets.
  const combosOf = new Map<string, StoredUnit["sets"][number]["combos"]>();
  for (const unit of stored) {
    for (const set of unit.sets) {
      if (set.opponentKey === undefined && set.combos.length > 0) {
        combosOf.set(`${set.subjectKey}|${unit.lane}`, set.combos);
      }
    }
  }
  const eligible = (unit: StoredUnit, subjectKey: string): boolean =>
    combosOf.has(`${subjectKey}|${unit.lane}`);
  const pairs = stored.filter(
    (unit) =>
      unit.sets.length === 2 &&
      unit.sets.some((set) => eligible(unit, set.subjectKey)),
  );
  const planned =
    values.limit === undefined ? pairs : pairs.slice(0, Number(values.limit));
  const sidesPlanned = planned.reduce(
    (sum, unit) =>
      sum + unit.sets.filter((set) => eligible(unit, set.subjectKey)).length,
    0,
  );
  console.log(
    `${planned.length.toString()} pair jobs, ${sidesPlanned.toString()} matchup sides with combos`,
  );

  await mkdir(REFS_CHECKPOINTS, { recursive: true });
  const done = new Set<string>();
  const existing = (await readdir(REFS_CHECKPOINTS).catch(() => [])).toSorted();
  let spent = 0;
  for (const name of existing) {
    const checkpoint = z
      .object({
        spentUsd: z.number(),
        units: z.array(z.object({ unitId: z.string() }).loose()),
      })
      .parse(await Bun.file(`${REFS_CHECKPOINTS}/${name}`).json());
    spent += checkpoint.spentUsd;
    for (const entry of checkpoint.units) {
      done.add(entry.unitId);
    }
  }

  const ctx = await createContext({
    maxCostUsd: Math.max(0.5, cap - spent),
    maxSearches: 0,
    maxFillPasses: 0,
  });
  let stopReason: string | undefined;
  let chunkNumber = existing.length;
  const todo = planned.filter((unit) => !done.has(unit.id));
  for (
    let from = 0;
    from < todo.length && stopReason === undefined;
    from += chunkSize
  ) {
    const slice = todo.slice(from, from + chunkSize);
    ctx.budget = new GenerationBudget(Math.max(0.2, cap - spent));
    const prepared = await Promise.all(
      slice.map(async (unit) => {
        const sets = await Promise.all(
          unit.sets.map(async (set) => {
            const subject = getChampionByKey(set.subjectKey);
            const opponent = getChampionByKey(set.opponentKey ?? "");
            if (subject === undefined || opponent === undefined) {
              throw new Error(`unknown champion in ${unit.id}`);
            }
            return {
              set,
              subject: await loadChampionGrounding(subject.id),
              opponent: await loadChampionGrounding(opponent.id),
              combos: combosOf.get(`${set.subjectKey}|${unit.lane}`) ?? [],
            };
          }),
        );
        return { unit, sets };
      }),
    );
    const jobs = prepared.map(
      ({ unit, sets }): BatchJob<z.infer<typeof RefsAnswerSchema>> => {
        const describe = (
          side: (typeof sets)[number],
          label: string,
        ): string =>
          side.combos.length === 0
            ? `${label}: ${side.subject.name} has no listed combos; return an empty list.`
            : [
                `${label}: ${side.subject.name} against ${side.opponent.name}.`,
                `${side.subject.name}'s combos (use these ids):`,
                ...side.combos.map(
                  (entry) =>
                    `- ${entry.combo.id}: ${describeCombo(entry.combo, side.subject)}`,
                ),
                `${side.opponent.name}'s abilities:`,
                ...Object.values(side.opponent.facts.abilities).map(
                  (ability) =>
                    `- ${ability.name}: ${ability.resolvedDescription.slice(0, 160)}`,
                ),
              ].join("\n");
        return {
          id: `refs:${unit.id}`,
          model: ctx.generator,
          system: SYSTEM,
          prefix: `${unit.lane} lane.`,
          rest: [
            describe(
              sets[0] ??
                (() => {
                  throw new Error("no sets");
                })(),
              '"forward"',
            ),
            "",
            describe(
              sets[1] ??
                (() => {
                  throw new Error("no sets");
                })(),
              '"reverse"',
            ),
          ].join("\n"),
          schema: RefsAnswerSchema,
          effort: "low",
          maxTokens: 500,
        };
      },
    );
    const results = await runJobs(ctx, "refs", jobs);
    const sidesOut: { unitId: string; sets: SideRefs[] }[] = [];
    for (const [index, { unit, sets }] of prepared.entries()) {
      const answer = results[index]?.outcome;
      const picks =
        answer?.status === "ok"
          ? [answer.object.forward, answer.object.reverse]
          : [[], []];
      const kept: SideRefs[] = sets.map((side, position) => {
        const chosen: StoredComboRef[] = [];
        const context = {
          champions: [side.subject, side.opponent],
          abilityIndex: ctx.abilityIndex,
          glossary: ctx.glossary,
        };
        for (const pick of picks[position] ?? []) {
          const combo = side.combos.find(
            (entry) => entry.combo.id === pick.comboId,
          );
          if (
            combo === undefined ||
            chosen.some((ref) => ref.comboId === pick.comboId) ||
            chosen.length >= MAX_REFS
          ) {
            continue;
          }
          const [fixed] = addMissingAbilityCites(
            [{ text: pick.note, cites: comboCites(combo.combo, side.subject) }],
            context,
          );
          if (
            fixed !== undefined &&
            validateTip(fixed, context).length === 0 &&
            validateComboRefs(
              [{ comboId: pick.comboId, note: pick.note }],
              [combo.combo],
              side.subject,
              context,
            ).length === 0
          ) {
            chosen.push({
              comboId: pick.comboId,
              note: pick.note,
              cites: fixed.cites,
            });
          }
        }
        return { subjectKey: side.set.subjectKey, comboRefs: chosen };
      });
      sidesOut.push({ unitId: unit.id, sets: kept });
    }
    const chunkSpend = ctx.ledger.spend.get("refs")?.usd ?? 0;
    spent += chunkSpend;
    await Bun.write(
      `${REFS_CHECKPOINTS}/refs-${chunkNumber.toString().padStart(3, "0")}.json`,
      JSON.stringify({ spentUsd: chunkSpend, units: sidesOut }),
    );
    chunkNumber += 1;
    ctx.ledger.spend.delete("refs");
    for (const entry of sidesOut) {
      done.add(entry.unitId);
    }
    const jobsDone = done.size;
    const projected = (spent / Math.max(1, jobsDone)) * planned.length;
    console.log(
      `${jobsDone.toString()} of ${planned.length.toString()} pair jobs, $${spent.toFixed(2)} spent, projected $${projected.toFixed(2)}`,
    );
    if (jobsDone >= planned.length * 0.1 && projected > cap) {
      stopReason = `projected spend $${projected.toFixed(2)} will not fit under $${cap.toString()}`;
    }
  }

  await applyRefs(stored);
  const known = await createTipStore({ directory: GENERATED }).glossary();
  const output = await writeOutputs(stored, known, {
    patch: latestVersion,
    model: ctx.generator,
    promptVersion: TIP_PROMPT_VERSION,
  });
  const withRefs = stored
    .flatMap((unit) => unit.sets)
    .filter((set) => (set.comboRefs ?? []).length > 0);
  console.log(
    JSON.stringify(
      {
        pairJobs: planned.length,
        pairJobsDone: done.size,
        sidesEligible: sidesPlanned,
        sidesWithRefs: withRefs.length,
        refs: withRefs.reduce(
          (sum, set) => sum + (set.comboRefs ?? []).length,
          0,
        ),
        spentUsd: spent,
        failedUnits: output.failed.length,
        stopReason: stopReason ?? null,
      },
      null,
      2,
    ),
  );
  if (stopReason !== undefined) {
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof TipBudgetExceededError) {
    console.log(`STOPPED: ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
