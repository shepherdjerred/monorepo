import type { z } from "zod";
import type {
  AbilityNameIndex,
  ChampionGrounding,
} from "#src/tips/grounding.ts";
import type { TipModel } from "#src/tips/model.ts";
import { CURRENT_GROUNDING_VERSION } from "#src/tips/input-hash.ts";
import type { WikiClient } from "#src/tips/wiki.ts";
import type {
  GeneralDraft,
  MatchupDraft,
  TipSource,
} from "#src/tips/prompt.ts";
import { knownSources } from "#src/tips/prompt.ts";
import {
  GENERAL_TIPS_MAX,
  GENERAL_TIPS_MIN,
  GeneralTipSetSchema,
  type GeneralTipSet,
  type GlossaryEntry,
  GlossaryEntrySchema,
  type GlossaryId,
  MATCHUP_TIPS_MAX,
  MATCHUP_TIPS_MIN,
  MatchupTipSetSchema,
  type MatchupTipSet,
  type Tip,
  TipSchema,
  type WikiRevisions,
} from "#src/tips/schema.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  type TipIssue,
  type TipValidationContext,
  addMissingAbilityCites,
  dropAbsentKeywordCites,
  validateGeneralTipSet,
  validateGlossaryEntry,
  validateMatchupPair,
} from "#src/tips/validate.ts";

/**
 * Checking a model's answer: shape it into the stored sets, then run the
 * validators. An answer is accepted only when there is not one issue.
 */

export type UnitEnvironment = {
  model: TipModel;
  promptVersion: string;
  abilityIndex: AbilityNameIndex;
  /** The glossary as it stands; proposals are validated against it. */
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  maxOutputTokens: number;
  /** The League of Legends Wiki; when absent the unit runs on the grounding alone. */
  wiki?: WikiClient | undefined;
};

export type MatchupResult = {
  forward: MatchupTipSet;
  reverse: MatchupTipSet;
  /** The sources each tip said it rests on, per direction; reported by the eval only. */
  basis: { forward: TipSource[][]; reverse: TipSource[][] };
  glossaryAdditions: GlossaryEntry[];
};

export type GeneralResult = {
  set: GeneralTipSet;
  basis: TipSource[][];
  glossaryAdditions: GlossaryEntry[];
};

export type Checked<Result> = {
  issues: TipIssue[];
  result: Result | undefined;
};

/** The `wiki` stamp of a set: present only when the unit used the wiki. */
function wikiField(wiki: WikiRevisions | undefined): {
  wiki?: WikiRevisions;
  groundingVersion: number;
} {
  return wiki === undefined || Object.keys(wiki).length === 0
    ? { groundingVersion: CURRENT_GROUNDING_VERSION }
    : { wiki, groundingVersion: CURRENT_GROUNDING_VERSION };
}

function zodIssues(error: z.ZodError, tip?: string): TipIssue[] {
  return error.issues.map((issue) => ({
    code: "set",
    message:
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    ...(tip === undefined ? {} : { tip }),
  }));
}

function parseTips(
  label: string,
  drafts: MatchupDraft["forward"],
  bounds: { min: number; max: number },
): { tips: Tip[]; bases: TipSource[][]; issues: TipIssue[] } {
  const issues: TipIssue[] = [];
  const tips: Tip[] = [];
  if (drafts.length < bounds.min || drafts.length > bounds.max) {
    issues.push({
      code: "set",
      message: `${label} has ${drafts.length.toString()} tips; write ${bounds.min.toString()} to ${bounds.max.toString()}`,
    });
  }
  for (const draft of drafts) {
    const parsed = TipSchema.safeParse({
      text: draft.text,
      cites: draft.cites,
    });
    if (parsed.success) {
      tips.push(parsed.data);
    } else {
      issues.push(...zodIssues(parsed.error, draft.text));
    }
  }
  return {
    tips,
    bases: drafts.map((draft) => knownSources(draft.basis)),
    issues,
  };
}

function parseGlossary(
  drafts: MatchupDraft["glossary"],
  context: TipValidationContext,
): { entries: GlossaryEntry[]; issues: TipIssue[] } {
  const entries: GlossaryEntry[] = [];
  const issues: TipIssue[] = [];
  for (const draft of drafts) {
    const parsed = GlossaryEntrySchema.safeParse({ ...draft, cites: [] });
    if (!parsed.success) {
      issues.push(
        ...zodIssues(parsed.error, draft.term).map((issue) => ({
          ...issue,
          message: `glossary entry ${draft.id}: ${issue.message}`,
        })),
      );
      continue;
    }
    const problems = validateGlossaryEntry(parsed.data, context);
    if (problems.length > 0) {
      issues.push(
        ...problems.map((problem) => ({
          ...problem,
          message: `glossary entry ${parsed.data.id}: ${problem.message}`,
        })),
      );
      continue;
    }
    entries.push(parsed.data);
  }
  return { entries, issues };
}

/** The proposals a tip actually cites, minus ids the glossary already has. */
function usedAdditions(
  proposals: readonly GlossaryEntry[],
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>,
  tips: readonly Tip[],
): GlossaryEntry[] {
  const cited = new Set(
    tips.flatMap((tip) =>
      tip.cites.flatMap((cite) => (cite.kind === "keyword" ? [cite.id] : [])),
    ),
  );
  const seen = new Set<GlossaryId>();
  return proposals.filter((entry) => {
    const keep =
      cited.has(entry.id) && !glossary.has(entry.id) && !seen.has(entry.id);
    seen.add(entry.id);
    return keep;
  });
}

function withProposals(
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>,
  proposals: readonly GlossaryEntry[],
): Map<GlossaryId, GlossaryEntry> {
  const merged = new Map(glossary);
  for (const entry of proposals) {
    if (!merged.has(entry.id)) {
      merged.set(entry.id, entry);
    }
  }
  return merged;
}

function validationContext(
  env: UnitEnvironment,
  champions: readonly ChampionGrounding[],
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>,
): TipValidationContext {
  return { champions, abilityIndex: env.abilityIndex, glossary };
}

export function checkMatchupDraft(input: {
  env: UnitEnvironment;
  lane: Lane;
  groundings: readonly [ChampionGrounding, ChampionGrounding];
  inputHash: string;
  /** The wiki pages the unit used, recorded on both sets. */
  wiki?: WikiRevisions | undefined;
  draft: MatchupDraft;
  general?: readonly GeneralTipSet[] | undefined;
}): Checked<MatchupResult> {
  const { env, lane, groundings, inputHash, draft } = input;
  const wikiStamp = wikiField(input.wiki);
  const [first, second] = groundings;
  const base = validationContext(env, groundings, env.glossary);
  const forward = parseTips("forward", draft.forward, {
    min: MATCHUP_TIPS_MIN,
    max: MATCHUP_TIPS_MAX,
  });
  const reverse = parseTips("reverse", draft.reverse, {
    min: MATCHUP_TIPS_MIN,
    max: MATCHUP_TIPS_MAX,
  });
  const glossary = parseGlossary(draft.glossary, base);
  const structural = [...forward.issues, ...reverse.issues, ...glossary.issues];
  if (structural.length > 0) {
    return { issues: structural, result: undefined };
  }
  const stamp = {
    lane,
    inputHash,
    promptVersion: env.promptVersion,
    model: env.model.name,
    ...wikiStamp,
  };
  const merged = withProposals(env.glossary, glossary.entries);
  const forwardTips = addMissingAbilityCites(
    dropAbsentKeywordCites(forward.tips, merged),
    base,
  );
  const reverseTips = addMissingAbilityCites(
    dropAbsentKeywordCites(reverse.tips, merged),
    base,
  );
  const forwardSet = MatchupTipSetSchema.safeParse({
    ...stamp,
    champion: first.championId,
    opponent: second.championId,
    tips: forwardTips,
  });
  const reverseSet = MatchupTipSetSchema.safeParse({
    ...stamp,
    champion: second.championId,
    opponent: first.championId,
    tips: reverseTips,
  });
  if (!forwardSet.success || !reverseSet.success) {
    return {
      issues: [
        ...(forwardSet.success ? [] : zodIssues(forwardSet.error)),
        ...(reverseSet.success ? [] : zodIssues(reverseSet.error)),
      ],
      result: undefined,
    };
  }
  const context = validationContext(env, groundings, merged);
  const issues = validateMatchupPair(
    {
      forward: forwardSet.data,
      reverse: reverseSet.data,
      ...(input.general === undefined ? {} : { general: input.general }),
    },
    context,
  );
  if (issues.length > 0) {
    return { issues, result: undefined };
  }
  return {
    issues: [],
    result: {
      forward: forwardSet.data,
      reverse: reverseSet.data,
      basis: { forward: forward.bases, reverse: reverse.bases },
      glossaryAdditions: usedAdditions(glossary.entries, env.glossary, [
        ...forwardTips,
        ...reverseTips,
      ]),
    },
  };
}

export function checkGeneralDraft(input: {
  env: UnitEnvironment;
  lane: Lane;
  grounding: ChampionGrounding;
  inputHash: string;
  wiki?: WikiRevisions | undefined;
  draft: GeneralDraft;
}): Checked<GeneralResult> {
  const { env, lane, grounding, inputHash, draft } = input;
  const wikiStamp = wikiField(input.wiki);
  const base = validationContext(env, [grounding], env.glossary);
  const tips = parseTips("tips", draft.tips, {
    min: GENERAL_TIPS_MIN,
    max: GENERAL_TIPS_MAX,
  });
  const glossary = parseGlossary(draft.glossary, base);
  const structural = [...tips.issues, ...glossary.issues];
  if (structural.length > 0) {
    return { issues: structural, result: undefined };
  }
  const merged = withProposals(env.glossary, glossary.entries);
  const keptTips = addMissingAbilityCites(
    dropAbsentKeywordCites(tips.tips, merged),
    base,
  );
  const set = GeneralTipSetSchema.safeParse({
    lane,
    champion: grounding.championId,
    tips: keptTips,
    inputHash,
    promptVersion: env.promptVersion,
    model: env.model.name,
    ...wikiStamp,
  });
  if (!set.success) {
    return { issues: zodIssues(set.error), result: undefined };
  }
  const issues = validateGeneralTipSet(
    set.data,
    validationContext(env, [grounding], merged),
  );
  if (issues.length > 0) {
    return { issues, result: undefined };
  }
  return {
    issues: [],
    result: {
      set: set.data,
      basis: tips.bases,
      glossaryAdditions: usedAdditions(
        glossary.entries,
        env.glossary,
        keptTips,
      ),
    },
  };
}
