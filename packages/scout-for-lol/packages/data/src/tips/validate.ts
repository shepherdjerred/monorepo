import type { AbilityFacts } from "#src/data-dragon/ability-facts.ts";
import { items } from "#src/data-dragon/item.ts";
import { getRuneInfo } from "#src/data-dragon/runes.ts";
import { summoner } from "#src/data-dragon/summoner.ts";
import type {
  AbilityNameIndex,
  ChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  type AbilityCite,
  type AbilityNumberCite,
  type Cite,
  GLOSSARY_DEFINITION_MAX_LENGTH,
  type GeneralTipSet,
  type GlossaryEntry,
  type GlossaryId,
  type MatchupTipSet,
  TIP_TEXT_MAX_LENGTH,
  type Tip,
} from "#src/tips/schema.ts";
import {
  NEAR_DUPLICATE_SIMILARITY,
  type TextIssue,
  normalizeQuotes,
  splitSentences,
  tipSimilarity,
  validateText,
} from "#src/tips/validate-text.ts";

export type TipIssueCode =
  | TextIssue["code"]
  | "uncited-ability"
  | "foreign-ability"
  | "bad-cite"
  | "set"
  | "near-duplicate";

export type TipIssue = {
  code: TipIssueCode;
  message: string;
  /** The tip text the issue is about, when it is about one tip. */
  tip?: string;
};

export type TipValidationContext = {
  /** The champions a tip may name: one for general tips, both for a matchup. */
  champions: readonly ChampionGrounding[];
  /** Every champion's ability names, to catch an ability from outside the unit. */
  abilityIndex: AbilityNameIndex;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
};

type CatalogCite = Extract<Cite, { kind: "item" | "spell" | "rune" }>;

const NUMBER_FIELDS: Record<string, (facts: AbilityFacts) => number[]> = {
  cooldown: (facts) => facts.cooldownByRank,
  cost: (facts) => facts.costByRank,
  range: (facts) => facts.rangeByRank,
};

function abilityNumberValues(
  facts: AbilityFacts,
  field: string,
): number[] | undefined {
  const fromField = NUMBER_FIELDS[field];
  return fromField === undefined ? facts.dataValues[field] : fromField(facts);
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function namePattern(name: string, flags = "gu"): RegExp {
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}'-])${escapeRegExp(name)}(?![\p{L}\p{N}-])`,
    flags,
  );
}

function mentions(text: string, term: string): boolean {
  return namePattern(term, "iu").test(text);
}

function checkChampionCite(
  cite: AbilityCite | AbilityNumberCite,
  context: TipValidationContext,
): string | undefined {
  const champion = context.champions.find(
    (entry) => entry.championId === cite.champion,
  );
  if (champion === undefined) {
    return `cites champion ${cite.champion.toString()}, who is not in this tip's matchup`;
  }
  const facts = champion.facts.abilities[cite.slot];
  if (cite.kind === "ability") {
    return facts.name === cite.name
      ? undefined
      : `${champion.name} ${cite.slot} is ${facts.name}, not ${cite.name}`;
  }
  const values = abilityNumberValues(facts, cite.field);
  if (values === undefined) {
    return `${facts.name} has no number field ${cite.field}`;
  }
  const missing = cite.values.filter(
    (value) => !values.some((fact) => Math.abs(fact - value) < 1e-9),
  );
  return missing.length === 0
    ? undefined
    : `${facts.name} ${cite.field} is ${values.join("/")}, not ${missing.join(", ")}`;
}

/** The Data Dragon name behind an item, summoner spell or rune cite. */
function catalogName(cite: CatalogCite): string | undefined {
  switch (cite.kind) {
    case "item": {
      return items.data[cite.id.toString()]?.name;
    }
    case "spell": {
      return Object.values(summoner.data).find(
        (spell) => Number(spell.key) === cite.id,
      )?.name;
    }
    case "rune": {
      return getRuneInfo(cite.id)?.name;
    }
  }
}

function checkCite(
  cite: Cite,
  text: string,
  context: TipValidationContext,
): string | undefined {
  switch (cite.kind) {
    case "ability":
    case "abilityNumber": {
      return checkChampionCite(cite, context);
    }
    case "item":
    case "spell":
    case "rune": {
      const name = catalogName(cite);
      return name === cite.name
        ? undefined
        : `${cite.kind} ${cite.id.toString()} is ${name ?? "unknown"}, not ${cite.name}`;
    }
    case "keyword": {
      const entry = context.glossary.get(cite.id);
      if (entry === undefined) {
        return `keyword ${cite.id} is not in the glossary`;
      }
      return [entry.term, ...entry.aliases].some((term) => mentions(text, term))
        ? undefined
        : `keyword ${cite.id} does not appear in the text`;
    }
  }
}

function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>();
  let from = 0;
  for (const sentence of splitSentences(text)) {
    const index = text.indexOf(sentence, from);
    starts.add(index);
    from = index + sentence.length;
  }
  return starts;
}

/** Character spans of names the tip cites as items, spells or runes. */
function citedNameSpans(
  text: string,
  cites: readonly Cite[],
): [number, number][] {
  return cites.flatMap((cite) =>
    cite.kind === "item" || cite.kind === "spell" || cite.kind === "rune"
      ? [...text.matchAll(namePattern(cite.name))].map(
          (match): [number, number] => [
            match.index,
            match.index + match[0].length,
          ],
        )
      : [],
  );
}

/**
 * Every ability name in the text must belong to a champion of the unit and be
 * cited. A one-word name of another champion's ability at the start of a
 * sentence is ordinary capitalisation ("Leap", "Purge") and is not counted.
 */
function checkAbilityNames(
  text: string,
  cites: readonly Cite[],
  context: TipValidationContext,
): TipIssue[] {
  const claimed = citedNameSpans(text, cites);
  const starts = sentenceStarts(text);
  const unitChampions = new Set(
    context.champions.map((entry) => entry.championId),
  );
  const issues: TipIssue[] = [];
  for (const owner of context.abilityIndex) {
    for (const match of text.matchAll(namePattern(owner.name))) {
      const span: [number, number] = [
        match.index,
        match.index + match[0].length,
      ];
      if (claimed.some(([start, end]) => span[0] < end && start < span[1])) {
        continue;
      }
      claimed.push(span);
      if (unitChampions.has(owner.championId)) {
        const cited = cites.some(
          (cite) =>
            cite.kind === "ability" &&
            cite.champion === owner.championId &&
            cite.slot === owner.slot,
        );
        if (!cited) {
          issues.push({
            code: "uncited-ability",
            message: `${owner.name} is named but not cited`,
          });
        }
      } else if (owner.name.includes(" ") || !starts.has(match.index)) {
        issues.push({
          code: "foreign-ability",
          message: `${owner.name} is an ability of a champion outside this tip`,
        });
      }
    }
  }
  return issues;
}

export function validateTip(
  tip: Tip,
  context: TipValidationContext,
): TipIssue[] {
  const text = normalizeQuotes(tip.text);
  const citedNumbers = tip.cites.flatMap((cite) =>
    cite.kind === "abilityNumber" ? cite.values : [],
  );
  const issues: TipIssue[] = [
    ...validateText(text, { maxLength: TIP_TEXT_MAX_LENGTH, citedNumbers }),
    ...tip.cites.flatMap((cite): TipIssue[] => {
      const problem = checkCite(cite, text, context);
      return problem === undefined
        ? []
        : [{ code: "bad-cite", message: problem }];
    }),
    ...checkAbilityNames(text, tip.cites, context),
  ];
  return issues.map((issue) => ({ ...issue, tip: tip.text }));
}

function nearDuplicates(
  left: readonly Tip[],
  right: readonly Tip[],
  label: string,
): TipIssue[] {
  const issues: TipIssue[] = [];
  for (const [leftIndex, leftTip] of left.entries()) {
    for (const [rightIndex, rightTip] of right.entries()) {
      if (left === right && rightIndex <= leftIndex) {
        continue;
      }
      const similarity = tipSimilarity(leftTip.text, rightTip.text);
      if (similarity >= NEAR_DUPLICATE_SIMILARITY) {
        issues.push({
          code: "near-duplicate",
          message: `${label}: "${rightTip.text}" repeats it (similarity ${similarity.toFixed(2)})`,
          tip: leftTip.text,
        });
      }
    }
  }
  return issues;
}

export function validateGeneralTipSet(
  set: GeneralTipSet,
  context: TipValidationContext,
): TipIssue[] {
  return [
    ...set.tips.flatMap((tip) => validateTip(tip, context)),
    ...nearDuplicates(set.tips, set.tips, "same set"),
  ];
}

/**
 * Both directions of one matchup unit, written by one call: each tip on its
 * own, then near-duplicates within a set, across the two directions and
 * against each champion's general tips in the lane.
 */
export function validateMatchupPair(
  pair: {
    forward: MatchupTipSet;
    reverse: MatchupTipSet;
    general?: readonly GeneralTipSet[];
  },
  context: TipValidationContext,
): TipIssue[] {
  const { forward, reverse } = pair;
  const issues: TipIssue[] = [];
  if (
    forward.lane !== reverse.lane ||
    forward.champion !== reverse.opponent ||
    forward.opponent !== reverse.champion ||
    forward.inputHash !== reverse.inputHash
  ) {
    issues.push({
      code: "set",
      message: "the two sets are not the two directions of one unit",
    });
  }
  issues.push(
    ...[forward, reverse].flatMap((set) =>
      set.tips.flatMap((tip) => validateTip(tip, context)),
    ),
    ...nearDuplicates(forward.tips, forward.tips, "same set"),
    ...nearDuplicates(reverse.tips, reverse.tips, "same set"),
    ...nearDuplicates(forward.tips, reverse.tips, "other direction"),
  );
  for (const set of [forward, reverse]) {
    const general = pair.general?.find(
      (entry) => entry.champion === set.champion && entry.lane === set.lane,
    );
    if (general !== undefined) {
      issues.push(...nearDuplicates(set.tips, general.tips, "general tips"));
    }
  }
  return issues;
}

export function validateGlossaryEntry(
  entry: GlossaryEntry,
  context: TipValidationContext,
): TipIssue[] {
  const definition = normalizeQuotes(entry.definition);
  const citedNumbers = entry.cites.flatMap((cite) =>
    cite.kind === "abilityNumber" ? cite.values : [],
  );
  return [
    ...validateText(definition, {
      maxLength: GLOSSARY_DEFINITION_MAX_LENGTH,
      citedNumbers,
    }),
    ...entry.cites.flatMap((cite): TipIssue[] => {
      const problem = checkCite(cite, definition, context);
      return problem === undefined
        ? []
        : [{ code: "bad-cite", message: problem }];
    }),
  ].map((issue) => ({ ...issue, tip: entry.term }));
}
