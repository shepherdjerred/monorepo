import { items } from "#src/data-dragon/item.ts";
import { summoner } from "#src/data-dragon/summoner.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import {
  COMBOS_MAX,
  COMBO_REFS_MAX,
  ComboSlotSchema,
  type Combo,
  type ComboRef,
  type ComboStep,
} from "#src/tips/combos/combo-schema.ts";
import type { Cite } from "#src/tips/schema.ts";
import {
  type TipIssue,
  type TipValidationContext,
  validateTip,
} from "#src/tips/validate.ts";

/**
 * Validation of combos and of a matchup side's references to them. A combo's
 * text goes through the same rules as a tip (no statistics, plain sentences,
 * every ability it names is one of its steps), its sequence must be castable,
 * and every step must exist in Data Dragon. An empty list is valid: most
 * champions have nothing worth listing.
 */

/** A rank-1 cooldown above this is not casual spam: the same slot twice needs a reason in the text. */
const REPEAT_COOLDOWN_SECONDS = 2;

/** Wording that says a repeat is a recast or a later-game combo, so the cooldown is not the limit. */
const LATER_GAME_OR_RECAST =
  /\b(?:recast|re-cast|again|second|third|later|late[- ]game|level \d+|rank \d+|cooldown reduction|ability haste)\b/iu;

function slotKey(
  slot: "P" | "Q" | "W" | "E" | "R",
): "passive" | "Q" | "W" | "E" | "R" {
  return slot === "P" ? "passive" : slot;
}

/** The ability cites a combo's steps stand for, so its text can name those abilities. */
export function comboCites(
  combo: Pick<Combo, "sequence">,
  champion: ChampionGrounding,
): Cite[] {
  return combo.sequence.flatMap((step): Cite[] => {
    if (step === "attack" || step.kind !== "ability") {
      return [];
    }
    if (step.champion !== champion.championId) {
      return [];
    }
    const slot = slotKey(step.slot);
    return [
      {
        kind: "ability",
        champion: champion.championId,
        slot,
        name: champion.facts.abilities[slot].name,
      },
    ];
  });
}

function stepIssues(
  step: ComboStep,
  champion: ChampionGrounding,
): string | undefined {
  if (step === "attack") {
    return undefined;
  }
  switch (step.kind) {
    case "ability": {
      return step.champion === champion.championId
        ? undefined
        : `a step uses ${step.slot} of champion ${step.champion.toString()}, not ${champion.name}`;
    }
    case "spell": {
      const spell = Object.values(summoner.data).find(
        (entry) => Number(entry.key) === step.id,
      );
      return spell?.name === step.name
        ? undefined
        : `summoner spell ${step.id.toString()} is ${spell?.name ?? "unknown"}, not ${step.name}`;
    }
    case "item": {
      const name = items.data[step.id.toString()]?.name;
      return name === step.name
        ? undefined
        : `item ${step.id.toString()} is ${name ?? "unknown"}, not ${step.name}`;
    }
  }
}

function repeatIssues(combo: Combo, champion: ChampionGrounding): string[] {
  const seen = new Map<string, number>();
  for (const step of combo.sequence) {
    const key =
      step === "attack"
        ? undefined
        : step.kind === "ability"
          ? `ability:${step.slot}`
          : `${step.kind}:${step.id.toString()}`;
    if (key !== undefined) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const wording = `${combo.text} ${combo.when}`;
  return [...seen.entries()].flatMap(([key, count]) => {
    if (count < 2 || LATER_GAME_OR_RECAST.test(wording)) {
      return [];
    }
    if (key.startsWith("ability:")) {
      const slot = key.slice("ability:".length);
      if (slot === "P") {
        return [];
      }
      const facts =
        champion.facts.abilities[slotKey(ComboSlotSchema.parse(slot))];
      const cooldown = facts.cooldownByRank[0] ?? 0;
      return cooldown > REPEAT_COOLDOWN_SECONDS
        ? [
            `${facts.name} is cast twice but its rank 1 cooldown is ${cooldown.toString()} seconds; say it is a recast or a later-game combo`,
          ]
        : [];
    }
    return [`${key} is used twice in one sequence`];
  });
}

const SLOT_ORDER = ["Q", "W", "E", "R"] as const;

/**
 * A "combo" that is only the champion's abilities cast in slot order (Q, then
 * W, then E, then R, with basic attacks anywhere) is what any player would do
 * with the kit, not a combo worth listing. A named trick (category `trick` or
 * `terrain`), a summoner spell or item in the sequence, a slot used twice, or
 * an order that is not slot order is what makes one worth listing.
 */
export function isGenericSequence(
  combo: Pick<Combo, "category" | "sequence">,
): boolean {
  if (combo.category === "trick" || combo.category === "terrain") {
    return false;
  }
  const slots: number[] = [];
  for (const step of combo.sequence) {
    if (step === "attack") {
      continue;
    }
    if (step.kind !== "ability") {
      return false;
    }
    if (step.slot !== "P") {
      slots.push(SLOT_ORDER.indexOf(step.slot));
    }
  }
  return slots.every(
    (slot, index) => index === 0 || slot > (slots[index - 1] ?? 0),
  );
}

/** Wording that gives away a generic damage order: any kit has a "full trade" or an "all-in". */
const GENERIC_WORDING =
  /\b(?:full trade|all[- ]in|full burst|standard (?:rotation|combo|damage)|damage order|max damage|burst combo)\b/iu;

/**
 * A generic damage rotation by its words: not a named trick, whatever order
 * its steps are in. A trick or a terrain spot may say "trade" in passing, so
 * only combos and rotations are held to it.
 */
export function isGenericWording(
  combo: Pick<Combo, "category" | "name" | "when" | "text">,
): boolean {
  return (
    (combo.category === "combo" || combo.category === "rotation") &&
    GENERIC_WORDING.test(`${combo.name} ${combo.when} ${combo.text}`)
  );
}

export function validateCombo(
  combo: Combo,
  champion: ChampionGrounding,
  context: TipValidationContext,
): TipIssue[] {
  const issues: TipIssue[] = [];
  const mark = (code: TipIssue["code"], message: string): void => {
    issues.push({ code, message, tip: combo.name });
  };
  const minSteps =
    combo.category === "combo" || combo.category === "rotation" ? 2 : 0;
  if (combo.sequence.length < minSteps) {
    mark(
      "set",
      `a ${combo.category} needs at least ${minSteps.toString()} steps`,
    );
  }
  if (isGenericSequence(combo) || isGenericWording(combo)) {
    mark(
      "set",
      'this is a generic damage order (abilities in slot order, or a "full trade" or "all-in") with no named trick; list only a well-known, champion-specific combo or trick',
    );
  }
  for (const step of combo.sequence) {
    const problem = stepIssues(step, champion);
    if (problem !== undefined) {
      mark("bad-cite", problem);
    }
  }
  for (const problem of repeatIssues(combo, champion)) {
    mark("set", problem);
  }
  const cites = comboCites(combo, champion);
  for (const [field, text] of [
    ["name", combo.name],
    ["when", combo.when],
    ["text", combo.text],
  ] as const) {
    for (const issue of validateTip({ text, cites }, context)) {
      issues.push({
        ...issue,
        message: `${field}: ${issue.message}`,
        tip: combo.name,
      });
    }
  }
  return issues;
}

/** A set's combos: each valid, ids unique, at most {@link COMBOS_MAX}; empty is fine. */
export function validateCombos(
  combos: readonly Combo[],
  champion: ChampionGrounding,
  context: TipValidationContext,
): TipIssue[] {
  const issues: TipIssue[] = [];
  if (combos.length > COMBOS_MAX) {
    issues.push({
      code: "set",
      message: `${combos.length.toString()} combos; at most ${COMBOS_MAX.toString()}`,
    });
  }
  const ids = new Set<string>();
  for (const combo of combos) {
    if (ids.has(combo.id)) {
      issues.push({
        code: "set",
        message: `combo id ${combo.id} is used twice`,
        tip: combo.name,
      });
    }
    ids.add(combo.id);
    issues.push(...validateCombo(combo, champion, context));
  }
  return issues;
}

/** A matchup side's references: known ids, no repeats, at most {@link COMBO_REFS_MAX}, notes in the same plain style. */
export function validateComboRefs(
  refs: readonly ComboRef[],
  combos: readonly Combo[],
  champion: ChampionGrounding,
  context: TipValidationContext,
): TipIssue[] {
  const issues: TipIssue[] = [];
  if (refs.length > COMBO_REFS_MAX) {
    issues.push({
      code: "set",
      message: `${refs.length.toString()} combo references; at most ${COMBO_REFS_MAX.toString()}`,
    });
  }
  const seen = new Set<string>();
  for (const ref of refs) {
    const combo = combos.find((entry) => entry.id === ref.comboId);
    if (combo === undefined) {
      issues.push({
        code: "bad-cite",
        message: `combo ${ref.comboId} does not exist`,
        tip: ref.note,
      });
      continue;
    }
    if (seen.has(ref.comboId)) {
      issues.push({
        code: "set",
        message: `combo ${ref.comboId} is referenced twice`,
        tip: ref.note,
      });
    }
    seen.add(ref.comboId);
    issues.push(
      ...validateTip(
        { text: ref.note, cites: comboCites(combo, champion) },
        context,
      ),
    );
  }
  return issues;
}
