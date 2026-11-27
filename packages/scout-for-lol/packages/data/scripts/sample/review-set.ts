// The review set: general sets and matchups for the champions Jerred plays,
// written by Sonnet and Opus on the same units (prompt tips-4, batches, cache,
// one retry), every tip judged by Sonnet medium and by the Decisions API with
// nothing dropped, written as one JSON array of units for a person to read.
//
//   review-set.ts --max-cost-usd 8 [--out <file>] [--plan]
//
// Units: the general set of each lane the plan keeps (at most two per
// champion, in the order Jerred listed them) and four matchups in the
// champion's primary lane against its most common opponents by the plan's lane
// priors, both directions; champions that share a lane also get their matchup
// against each other. `--plan` prints the units and spends nothing.

import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import { getChampionIdByName } from "#src/model/riot/champion-registry.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import { verdictFromScores } from "#src/tips/eval/decisions.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import {
  type PipelineResult,
  type PipelineUnit,
  runPipeline,
} from "./pipeline.ts";

const DEFAULT_OUT =
  "/Users/jerred/.local/share/scout-redesign/tips-review/review-set.json";
const OPPONENTS_PER_CHAMPION = 4;
const MAX_LANES = 2;

/** The champions, with the lanes to try in order; the first the plan keeps is the primary lane. */
const CHAMPIONS: readonly { name: string; lanes: readonly Lane[] }[] = [
  { name: "Warwick", lanes: ["jungle", "top"] },
  { name: "Ahri", lanes: ["middle"] },
  { name: "Heimerdinger", lanes: ["middle", "top", "support"] },
  { name: "Xerath", lanes: ["middle", "support"] },
  { name: "Tryndamere", lanes: ["top"] },
  { name: "Jax", lanes: ["top", "jungle"] },
];

type Selection = {
  units: PipelineUnit[];
  notes: string[];
};

export function select(): Selection {
  const plan = planTips(lanePriorTipPlanSource(currentLanePriors));
  const notes: string[] = [];
  const units: PipelineUnit[] = [];
  const mine = new Map<ChampionId, Lane>();

  for (const { name, lanes } of CHAMPIONS) {
    const id = getChampionIdByName(name);
    if (id === undefined) {
      throw new Error(`unknown champion ${name}`);
    }
    const kept = lanes.filter((lane) =>
      plan.championLanes.some(
        (entry) => entry.championId === id && entry.lane === lane,
      ),
    );
    const chosen = kept.slice(0, MAX_LANES);
    const dropped = lanes.filter((lane) => !chosen.includes(lane));
    notes.push(
      `${name}: general sets for ${chosen.join(", ") || "none"}${dropped.length > 0 ? `; not kept by the plan or beyond the lane limit: ${dropped.join(", ")}` : ""}`,
    );
    for (const lane of chosen) {
      units.push({ lane, championIds: [id] });
    }
    // The primary lane is the first of his lanes the plan keeps.
    const primary = kept[0];
    const entry = plan.championLanes.find(
      (candidate) => candidate.championId === id && candidate.lane === primary,
    );
    if (primary === undefined || entry === undefined) {
      notes.push(`${name}: the plan keeps no primary lane, no matchups`);
      continue;
    }
    mine.set(id, primary);
    for (const opponent of entry.opponents.slice(0, OPPONENTS_PER_CHAMPION)) {
      units.push({ lane: primary, championIds: [id, opponent] });
    }
  }

  // Champions that share a primary lane meet each other.
  const owned = [...mine.entries()];
  for (const [index, [left, lane]] of owned.entries()) {
    for (const [right, otherLane] of owned.slice(index + 1)) {
      if (lane === otherLane) {
        units.push({ lane, championIds: [left, right] });
      }
    }
  }

  // One unit per lane and unordered pair; a pair's lead champion is its lower id.
  const seen = new Set<string>();
  const unique = units.flatMap((unit) => {
    const ids = [...unit.championIds].toSorted((a, b) => a - b);
    const key = `${unit.lane}:${ids.join("-")}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ lane: unit.lane, championIds: ids }];
  });
  return { units: unique, notes };
}

function unitId(shortModel: string, outcome: PipelineResult["outcomes"][0]) {
  const names = outcome.groundings.map((grounding) => grounding.name);
  return {
    key: `${outcome.unit.lane}:${names.join("-vs-")}`,
    id: `${shortModel}:${outcome.unit.lane}:${names.join("-vs-")}`,
  };
}

function reviewUnits(shortModel: string, result: PipelineResult) {
  return result.outcomes.flatMap((outcome) => {
    if (outcome.sets === undefined) {
      return [];
    }
    const { key, id } = unitId(shortModel, outcome);
    let offset = 0;
    return outcome.sets.map((set) => {
      const unit = {
        id: `${id}${set.side === undefined ? "" : `:${set.side}`}`,
        key: `${key}${set.side === undefined ? "" : `:${set.side}`}`,
        kind: set.opponent === undefined ? "general" : "matchup",
        champion: set.subject.name,
        lane: outcome.unit.lane,
        ...(set.opponent === undefined ? {} : { opponent: set.opponent.name }),
        ...(set.side === undefined ? {} : { direction: set.side }),
        model: result.generator,
        tips: set.tips.map((tip, position) => {
          const index = offset + position;
          const sonnet = outcome.sonnet?.find((entry) => entry.index === index);
          const decision = outcome.decisions?.[index];
          const abilities = tip.cites.flatMap((cite) =>
            cite.kind === "ability" ? [cite] : [],
          );
          return {
            id: `${id}${set.side === undefined ? "" : `:${set.side}`}:${position.toString()}`,
            text: tip.text,
            abilities: [...new Set(abilities.map((cite) => cite.name))],
            abilityRefs: abilities.map((cite) => ({
              champion: cite.champion,
              slot: cite.slot,
              name: cite.name,
            })),
            judges: {
              sonnet:
                sonnet === undefined
                  ? null
                  : { verdict: sonnet.correctness, reason: sonnet.reason },
              decisions:
                decision === undefined
                  ? null
                  : {
                      verdict: verdictFromScores(decision).correctness,
                      pWrong: decision.pWrong,
                    },
            },
          };
        }),
      };
      offset += set.tips.length;
      return unit;
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      out: { type: "string", default: DEFAULT_OUT },
      plan: { type: "boolean", default: false },
    },
    strict: true,
  });
  const { units, notes } = select();
  const generalCount = units.filter(
    (unit) => unit.championIds.length === 1,
  ).length;
  console.log(
    `${notes.join("\n")}\n${generalCount.toString()} general units, ${(units.length - generalCount).toString()} pair units (two directions each)`,
  );
  for (const unit of units) {
    console.log(
      `  ${unit.lane} ${unit.championIds.map((id) => id.toString()).join(" vs ")}`,
    );
  }
  if (values.plan) {
    return;
  }
  const budget = new GenerationBudget(Number(values["max-cost-usd"]));
  const generators = [
    { model: "claude-sonnet-5-5", short: "sonnet" },
    { model: "claude-opus-5-5", short: "opus" },
  ] as const;
  // One generator at a time: each round reserves its worst case against the
  // budget, and two pipelines in flight would not both fit under a tight cap.
  const results: PipelineResult[] = [];
  await mkdir(values.out.slice(0, values.out.lastIndexOf("/")), {
    recursive: true,
  });
  const all: ReturnType<typeof reviewUnits> = [];
  for (const { model, short } of generators) {
    const result = await runPipeline({
      units,
      generator: model,
      judge: "claude-sonnet-5-5",
      budget,
      maxTokens: { matchup: 4500, general: 3500 },
      log: (line) => {
        console.log(`[${model}] ${line}`);
      },
    });
    results.push(result);
    all.push(...reviewUnits(short, result));
    // Written after each generator, so a later failure keeps what is paid for.
    await Bun.write(values.out, `${JSON.stringify(all, null, 2)}\n`);
  }

  for (const result of results) {
    const mine = all.filter((unit) => unit.model === result.generator);
    const failed = result.outcomes.filter((outcome) => !outcome.passed);
    console.log(
      `${result.generator}: ${mine.length.toString()} units, ${mine.reduce((sum, unit) => sum + unit.tips.length, 0).toString()} tips; ${failed.length.toString()} pair or general units failed the validators${failed.map((outcome) => ` [${outcome.groundings.map((g) => g.name).join(" vs ")}: ${outcome.retryIssues.concat(outcome.issues).slice(0, 2).join(" | ")}]`).join("")}; generation $${result.generation.costUsd.toFixed(3)}, Sonnet judge $${result.sonnet.costUsd.toFixed(3)}, Decisions $${result.decisions.costUsd.toFixed(3)}`,
    );
  }
  console.log(`spent ${budget.spentUsd.toFixed(4)} (batches) plus Decisions`);
  console.log(`wrote ${values.out}`);
}

if (import.meta.main) {
  await main();
}
