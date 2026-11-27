// Combos, tricks, rotations and terrain spots: written for a champion in a lane
// (an empty list is the expected answer for a simple kit), every one checked by
// the escalation judge (wiki lookup and web search) before it is kept, and
// referenced from the matchup sets where it matters.

import { z } from "zod";
import { items } from "#src/data-dragon/item.ts";
import { summoner } from "#src/data-dragon/summoner.ts";
import {
  COMBO_CATEGORIES,
  COMBOS_MAX,
  COMBO_REFS_MAX,
  type Combo,
  type ComboRef,
  type ComboStep,
} from "#src/tips/combos/combo-schema.ts";
import { validateComboRefs, validateCombos } from "#src/tips/combos/combos.ts";
import { sharedWordRun } from "#src/tips/copy-check.ts";
import { JudgeDraftSchema } from "#src/tips/eval/judge.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import { describeChampion } from "#src/tips/prompt.ts";
import type { TipValidationContext } from "#src/tips/validate.ts";
import { lookupWikiPage } from "#src/tips/wiki.ts";
import type { BatchJob } from "../tips-batch.ts";
import { runJobs } from "./draft.ts";
import { ESCALATION_RULES } from "./escalate.ts";
import { type Context, type ComboState, type UnitState } from "./state.ts";

const COMBO_SYSTEM = `You list the well-known combos and mechanical tricks of one League of Legends champion in one lane, for casual players. Use the champion's facts and wiki notes below.

An empty list is the default answer. Most champions have nothing to list, and a short or empty list is better than a padded one. Only list an entry that is BOTH well known AND specific to this champion: something players of the champion would recognise by name or description, such as a signature animation cancel, a buffered cast, a flash-and-cast timing, a ward hop, the order of a dash and a cast, or a wall hop. Do not list:
- a damage order that is just the abilities in slot order (Q then W then E then R), or a generic "full trade" or "all-in" rotation;
- anything any champion with those abilities would do, such as "land the stun, then follow up";
- anything you are not sure exists in the game.
If you are unsure, leave it out.

Each entry has:
- "name": short, for example "Charm catch", at most 35 characters.
- "category": one of ${COMBO_CATEGORIES.join(", ")}. "combo": a well-known sequence of abilities whose order is not simply slot order. "trick": a mechanical trick (animation cancel, buffering, flash timing, ward hop, the order of a dash and a cast). "rotation": only when the order is non-obvious AND well known; never a generic damage order. "terrain": a wall hop or dash-over spot.
- "steps": the sequence, each step one of "P", "Q", "W", "E", "R" (an ability slot of this champion), "attack" (a basic attack), "spell:<summoner spell name>", or "item:<item name>" for an item active. A terrain entry may have no steps, or only the ability that crosses the wall.
- "when": one plain sentence, the situation to use it, at most 150 characters.
- "text": one or two plain sentences, how and why, at most 150 characters in all. A terrain spot is named in plain words ("the wall between blue buff and the river"), with no coordinates.

Rules: plain sentences, no statistics, no percentages, no win rates. Name an ability only when it is one of the steps. A slot may appear twice in one sequence only if it is a recast or the text says it is a later-game combo. At most ${COMBOS_MAX.toString()} entries.`;

const ComboDraftSchema = z.object({
  combos: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      steps: z.array(z.string()),
      when: z.string(),
      text: z.string(),
    }),
  ),
});

const COMBO_JUDGE_SYSTEM = `You check League of Legends combos, tricks, rotations and terrain spots listed for one champion. For each, decide whether it is real and works as described.
- correct: you can confirm it from the facts, the wiki notes, a page you looked up, or a search: the steps can be done in that order, the trick or cancel exists, the terrain spot exists.
- wrong: the facts or a source contradict it, or it is impossible (a cancel that does not exist, a buffer that cannot be done, a cast order that does nothing, a spot that is not there).
- not-checkable: you could not confirm it. Most invented tricks end here; do not mark one correct on a guess.
Return one verdict per entry with its index, a one-line reason, and the sources you used.`;

function stepName(step: ComboStep, champion: ChampionGrounding): string {
  if (step === "attack") {
    return "basic attack";
  }
  if (step.kind === "ability") {
    const key = step.slot === "P" ? "passive" : step.slot;
    return `${step.slot} (${champion.facts.abilities[key].name})`;
  }
  return step.name;
}

export function describeCombo(
  combo: Combo,
  champion: ChampionGrounding,
): string {
  return `${combo.name} [${combo.category}]: ${combo.sequence.map((step) => stepName(step, champion)).join(", then ") || "no steps"}. When: ${combo.when} How: ${combo.text}`;
}

function parseStep(
  raw: string,
  champion: ChampionGrounding,
): ComboStep | string {
  const text = raw.trim();
  if (/^attack$/iu.test(text)) {
    return "attack";
  }
  if (/^[PQWER]$/u.test(text)) {
    return {
      kind: "ability",
      champion: champion.championId,
      slot: text as "P" | "Q" | "W" | "E" | "R",
    };
  }
  const [kind, ...rest] = text.split(":");
  const name = rest.join(":").trim().toLowerCase();
  if (kind === "spell") {
    const spell = Object.values(summoner.data).find(
      (entry) => entry.name.toLowerCase() === name,
    );
    return spell === undefined
      ? `unknown summoner spell "${rest.join(":")}"`
      : { kind: "spell", id: Number(spell.key), name: spell.name };
  }
  if (kind === "item") {
    const found = Object.entries(items.data).find(
      ([, entry]) => entry.name.toLowerCase() === name,
    );
    return found === undefined
      ? `unknown item "${rest.join(":")}"`
      : { kind: "item", id: Number(found[0]), name: found[1].name };
  }
  return `unknown step "${text}"`;
}

function tipContext(
  ctx: Context,
  champion: ChampionGrounding,
): TipValidationContext {
  return {
    champions: [champion],
    abilityIndex: ctx.abilityIndex,
    glossary: ctx.glossary,
  };
}

function generalUnits(units: readonly UnitState[]): UnitState[] {
  return units.filter(
    (unit) => unit.sets.length === 1 && unit.sets[0] !== undefined,
  );
}

/** Write each general set's combos; invalid ones are dropped, an empty list is fine. */
export async function generateCombos(
  ctx: Context,
  units: readonly UnitState[],
): Promise<void> {
  const todo = generalUnits(units);
  const jobs = todo.map((unit): BatchJob<typeof ComboDraftSchema._output> => {
    const champion = unit.groundings[0];
    if (champion === undefined) {
      throw new Error("a unit has no champion");
    }
    return {
      id: `combos:${unit.id}`,
      model: ctx.generator,
      system: COMBO_SYSTEM,
      prefix: describeChampion("Champion", champion, unit.notes[0]),
      rest: `List the well-known, ${champion.name}-specific combos and tricks in ${unit.lane} lane, or an empty list (the default) if none qualifies.`,
      schema: ComboDraftSchema,
      effort: "medium",
      maxTokens: 3500,
      lookup: (title) => lookupWikiPage(ctx.wiki, title),
    };
  });
  const results = await runJobs(ctx, "combos:generate", jobs);
  for (const [index, unit] of todo.entries()) {
    const result = results[index];
    const set = unit.sets[0];
    const champion = unit.groundings[0];
    if (
      result?.outcome.status !== "ok" ||
      set === undefined ||
      champion === undefined
    ) {
      ctx.ledger.bump("combos:generate", "failed jobs");
      continue;
    }
    for (const [position, draft] of result.outcome.object.combos
      .slice(0, COMBOS_MAX)
      .entries()) {
      const steps = draft.steps.map((step) => parseStep(step, champion));
      const bad = steps.find(
        (step): step is string => typeof step === "string" && step !== "attack",
      );
      const category = COMBO_CATEGORIES.find((name) => name === draft.category);
      const base = {
        id: `${set.id}:combo:${position.toString()}`,
        name: draft.name,
        when: draft.when,
        text: draft.text,
      };
      ctx.ledger.bump("combos:generate", "combos written");
      if (bad !== undefined || category === undefined) {
        ctx.ledger.bump("combos:generate", "rejected: bad step or category");
        continue;
      }
      const combo: Combo = {
        ...base,
        category,
        sequence: steps.filter(
          (step): step is ComboStep =>
            typeof step !== "string" || step === "attack",
        ),
      };
      const issues = validateCombos(
        [combo],
        champion,
        tipContext(ctx, champion),
      );
      const copied = sharedWordRun(`${combo.when} ${combo.text}`, unit.notes);
      if (issues.length > 0 || copied !== undefined) {
        ctx.ledger.bump(
          "combos:generate",
          `rejected by the validators: ${issues[0]?.code ?? "copied a source"}`,
        );
        continue;
      }
      set.combos.push({
        combo,
        history: [{ pass: "combos:generate" }],
        status: "live",
      });
    }
  }
}

/** Every combo and trick goes to the escalation judge, wiki lookup and web search included. */
export async function escalateCombos(
  ctx: Context,
  units: readonly UnitState[],
): Promise<void> {
  const work = generalUnits(units).flatMap((unit) => {
    const set = unit.sets[0];
    const live = set?.combos.filter((entry) => entry.status === "live") ?? [];
    return set === undefined || live.length === 0 ? [] : [{ unit, live }];
  });
  const jobs = work.map(
    ({ unit, live }): BatchJob<typeof JudgeDraftSchema._output> => {
      const champion = unit.groundings[0];
      if (champion === undefined) {
        throw new Error("a unit has no champion");
      }
      return {
        id: `combos:escalate:${unit.id}`,
        model: ctx.judge,
        system: `${COMBO_JUDGE_SYSTEM}\n${ESCALATION_RULES}`,
        prefix: describeChampion("Champion", champion, unit.notes[0]),
        rest: [
          `Entries for ${champion.name} in ${unit.lane} lane, numbered from 0:`,
          ...live.map(
            (entry, index) =>
              `${index.toString()}. ${describeCombo(entry.combo, champion)}`,
          ),
        ].join("\n"),
        schema: JudgeDraftSchema,
        effort: "medium",
        maxTokens: 3000,
        lookup: (title) => lookupWikiPage(ctx.wiki, title),
        search: {
          type: ctx.searchTool,
          maxUses: ctx.searchesPerTip * live.length,
        },
      };
    },
  );
  const results = await runJobs(ctx, "combos:escalate", jobs);
  for (const [index, { live }] of work.entries()) {
    const result = results[index];
    const verdicts =
      result?.outcome.status === "ok" ? result.outcome.object.verdicts : [];
    for (const [position, entry] of live.entries()) {
      const verdict = verdicts.find(
        (candidate) => candidate.index === position,
      );
      const decided = verdict?.correctness ?? "not-checkable";
      const reason = verdict?.reason ?? "no verdict";
      entry.escalation = { verdict: decided, reason };
      entry.history.push({
        pass: "combos:escalate",
        judge: "sonnet-medium",
        verdict: decided,
        reason,
        sources: verdict?.sources ?? [],
        lookups: result?.toolCalls ?? 0,
        searches: result?.searches ?? 0,
        urls: result?.searchUrls ?? [],
      });
      ctx.ledger.bump("combos:escalate", `verdict ${decided}`);
      if (decided !== "correct") {
        // Combos and tricks are where models invent things: only a confirmed one is kept.
        entry.status = "dropped";
        entry.droppedBecause = `${decided}: ${reason}`;
        entry.history.push({ pass: "combos:escalate", outcome: "dropped" });
      }
    }
  }
}

const RefDraftSchema = z.object({
  forward: z.array(z.object({ comboId: z.string(), note: z.string() })),
  reverse: z.array(z.object({ comboId: z.string(), note: z.string() })),
});

/** Each side of a matchup may point at up to three of its champion's confirmed combos; no new combos are made here. */
export async function referenceCombos(
  ctx: Context,
  units: readonly UnitState[],
): Promise<void> {
  const generals = generalUnits(units);
  const combosOf = (champion: ChampionGrounding, lane: string): ComboState[] =>
    generals
      .filter(
        (unit) =>
          unit.lane === lane &&
          unit.groundings[0]?.championId === champion.championId,
      )
      .flatMap(
        (unit) =>
          unit.sets[0]?.combos.filter((entry) => entry.status === "live") ?? [],
      );
  const work = units.flatMap((unit) => {
    const [first, second] = unit.groundings;
    if (first === undefined || second === undefined) {
      return [];
    }
    const forward = combosOf(first, unit.lane);
    const reverse = combosOf(second, unit.lane);
    return forward.length + reverse.length > 0
      ? [{ unit, first, second, forward, reverse }]
      : [];
  });
  const jobs = work.map(
    ({
      unit,
      first,
      second,
      forward,
      reverse,
    }): BatchJob<typeof RefDraftSchema._output> => {
      const list = (
        champion: ChampionGrounding,
        combos: ComboState[],
      ): string[] =>
        combos.length === 0
          ? [`${champion.name} has no listed combos.`]
          : [
              `${champion.name}'s combos (reference them by id):`,
              ...combos.map(
                (entry) =>
                  `- ${entry.combo.id}: ${describeCombo(entry.combo, champion)}`,
              ),
            ];
      return {
        id: `refs:${unit.id}`,
        model: ctx.generator,
        system: `You connect a champion's listed combos to a matchup. For each side, pick up to ${COMBO_REFS_MAX.toString()} of that champion's listed combos that matter in this matchup, each with a one-line note on why it works or fails against this opponent. Use only the ids listed; never invent a combo. Plain sentences, no statistics, name an ability only if it is part of that combo. Return an empty list for a side with nothing relevant.`,
        prefix: describeChampion("Champion", first, unit.notes[0]),
        rest: [
          describeChampion("Champion", second, unit.notes[1]),
          "",
          `${first.name} against ${second.name} in ${unit.lane} lane.`,
          ...list(first, forward),
          ...list(second, reverse),
          '"forward" is for the player of ' +
            first.name +
            ', "reverse" for the player of ' +
            second.name +
            ".",
        ].join("\n"),
        schema: RefDraftSchema,
        effort: "low",
        maxTokens: 1500,
      };
    },
  );
  const results = await runJobs(ctx, "combos:refs", jobs);
  for (const [
    index,
    { unit, first, second, forward, reverse },
  ] of work.entries()) {
    const result = results[index];
    if (result?.outcome.status !== "ok") {
      continue;
    }
    for (const [set, champion, combos, picks] of [
      [unit.sets[0], first, forward, result.outcome.object.forward],
      [unit.sets[1], second, reverse, result.outcome.object.reverse],
    ] as const) {
      if (set === undefined) {
        continue;
      }
      const refs: ComboRef[] = [];
      for (const pick of picks.slice(0, COMBO_REFS_MAX)) {
        const issues = validateComboRefs(
          [pick],
          combos.map((entry) => entry.combo),
          champion,
          tipContext(ctx, champion),
        );
        if (issues.length > 0) {
          ctx.ledger.bump("combos:refs", "references rejected");
          continue;
        }
        refs.push(pick);
      }
      set.comboRefs = refs.map((ref) => ({
        ref,
        history: [{ pass: "combos:refs" }],
      }));
      ctx.ledger.bump("combos:refs", "references kept", refs.length);
    }
  }
}
