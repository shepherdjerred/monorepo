// Re-run only the combo passes (generate, escalate with lookup and search,
// reference from matchups) over the units of an existing review-set-v2.json and
// write the results into that file; the tips and their histories are untouched.
//
//   pipeline/combos-only.ts --max-cost-usd 1 [--max-searches 20] [--v2 <file>]

import { parseArgs } from "node:util";
import { z } from "zod";
import { select } from "../sample/review-set.ts";
import { escalateCombos, generateCombos, referenceCombos } from "./combos.ts";
import { createContext } from "./context.ts";
import type { UnitState } from "./state.ts";
import { loadUnit } from "./units.ts";

const DIRECTORY = "/Users/jerred/.local/share/scout-redesign/tips-review";

const SetSchema = z.object({ id: z.string() }).loose();

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      "max-searches": { type: "string", default: "20" },
      v2: { type: "string", default: `${DIRECTORY}/review-set-v2.json` },
    },
    strict: true,
  });
  const ctx = await createContext({
    maxCostUsd: Number(values["max-cost-usd"]),
    maxSearches: Number(values["max-searches"]),
  });
  const units: UnitState[] = [];
  for (const unit of select().units) {
    units.push(
      await loadUnit({
        wiki: ctx.wiki,
        lane: unit.lane,
        championIds: unit.championIds,
        model: ctx.generator,
        earlier: [],
      }),
    );
  }
  await generateCombos(ctx, units);
  await escalateCombos(ctx, units);
  await referenceCombos(ctx, units);

  const sets = new Map(
    units.flatMap((unit) => unit.sets.map((set) => [set.id, set] as const)),
  );
  const file = z.array(SetSchema).parse(await Bun.file(values.v2).json());
  const patched = file.map((entry) => {
    const set = sets.get(entry.id);
    if (set === undefined) {
      return entry;
    }
    return set.opponent === undefined
      ? {
          ...entry,
          combos: set.combos
            .filter((combo) => combo.status === "live")
            .map((combo) => ({
              ...combo.combo,
              judges: {
                sonnet: combo.escalation
                  ? {
                      verdict: combo.escalation.verdict,
                      reason: combo.escalation.reason,
                    }
                  : null,
              },
              history: combo.history,
            })),
          droppedCombos: set.combos
            .filter((combo) => combo.status === "dropped")
            .map((combo) => ({
              ...combo.combo,
              droppedBecause: combo.droppedBecause,
              history: combo.history,
            })),
        }
      : {
          ...entry,
          comboRefs: set.comboRefs.map((ref) => ({
            ...ref.ref,
            history: ref.history,
          })),
        };
  });
  await Bun.write(values.v2, `${JSON.stringify(patched, null, 2)}\n`);
  const spent = Object.fromEntries(ctx.ledger.spend);
  console.log(
    JSON.stringify(
      {
        spend: spent,
        stats: Object.fromEntries(ctx.ledger.stats),
        searches: ctx.searches.used,
        budget: ctx.budget.spentUsd,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  await main();
}
