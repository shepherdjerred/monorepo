import type { z } from "zod";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  type Checked,
  type GeneralResult,
  type MatchupResult,
  type UnitEnvironment,
  checkGeneralDraft,
  checkMatchupDraft,
} from "#src/tips/check-draft.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import {
  CURRENT_GROUNDING_VERSION,
  type TipHashExtras,
  computeTipInputHash,
} from "#src/tips/input-hash.ts";
import { type TipUsage, TipOutputError, addUsage } from "#src/tips/model.ts";
import {
  GENERAL_SCHEMA_NAME,
  GeneralDraftSchema,
  MATCHUP_SCHEMA_NAME,
  MatchupDraftSchema,
  type TipPrompt,
  buildGeneralPrompt,
  buildMatchupPrompt,
  buildRetryPrompt,
} from "#src/tips/prompt.ts";
import type { GeneralTipSet, WikiRevisions } from "#src/tips/schema.ts";
import type { TipIssue } from "#src/tips/validate.ts";
import {
  type PrefetchedWiki,
  lookupWikiPage,
  prefetchChampionWiki,
} from "#src/tips/wiki.ts";

/**
 * One generation unit end to end: prefetch both champions' wiki notes, build
 * the prompt, call the model (which may look further pages up), validate the
 * answer, and on failure retry once with the validator's findings fed back.
 * Pure with respect to the disk: callers decide what to write.
 *
 * The input hash covers the grounding and the revision of every wiki page the
 * accepted answer used: the prefetched notes plus any page the model looked up.
 */

export type UnitAttempt = {
  /** What the model returned; undefined when it never answered in the requested shape. */
  draft: unknown;
  issues: TipIssue[];
  usage: TipUsage;
  cached: boolean;
  /** `lookup` calls the model made in this attempt. */
  toolCalls: number;
};

type OutcomeCommon = {
  firstAttemptIssues: TipIssue[];
  attempts: UnitAttempt[];
  usage: TipUsage;
  /** `lookup` calls across the attempts. */
  toolCalls: number;
  /** The wiki pages the last attempt used, page title to revision id. */
  wiki: WikiRevisions;
};

export type UnitOutcome<Result> =
  | ({
      status: "ok";
      result: Result;
      /** Validator findings on the first answer; empty when it passed as given. */
    } & OutcomeCommon)
  | ({ status: "dropped"; issues: TipIssue[] } & OutcomeCommon);

/** Only a billed answer in the wrong shape is a drop; the error text stays in the report. */
function notInShape(error: Error): TipIssue {
  return {
    code: "set",
    message: `the answer did not match the requested JSON shape: ${error.message}`,
  };
}

type Stamp = { inputHash: string; wiki: WikiRevisions };

type UnitCheck<Draft, Result> = (draft: Draft, stamp: Stamp) => Checked<Result>;

type AttemptResult<Draft, Result> = {
  draft: Draft | undefined;
  checked: Checked<Result>;
  attempt: UnitAttempt;
  wiki: WikiRevisions;
};

async function attemptOnce<Draft, Result>(input: {
  env: UnitEnvironment;
  prompt: string;
  system: string;
  schema: z.ZodType<Draft>;
  schemaName: string;
  prefetched: PrefetchedWiki | undefined;
  hashFor: (wiki: WikiRevisions) => string;
  check: UnitCheck<Draft, Result>;
}): Promise<AttemptResult<Draft, Result>> {
  const { env } = input;
  const wikiClient = env.wiki;
  const base = input.prefetched?.pages ?? {};
  try {
    const answer = await env.model.generate({
      system: input.system,
      prompt: input.prompt,
      schema: input.schema,
      schemaName: input.schemaName,
      maxOutputTokens: env.maxOutputTokens,
      lookup:
        wikiClient === undefined
          ? undefined
          : (title) => lookupWikiPage(wikiClient, title),
    });
    const wiki = { ...base, ...answer.lookedUp };
    const checked = input.check(answer.object, {
      inputHash: input.hashFor(wiki),
      wiki,
    });
    return {
      draft: answer.object,
      checked,
      wiki,
      attempt: {
        draft: answer.object,
        issues: checked.issues,
        usage: answer.usage,
        cached: answer.cached,
        toolCalls: answer.toolCalls,
      },
    };
  } catch (error: unknown) {
    if (!(error instanceof TipOutputError)) {
      throw error;
    }
    const issue = notInShape(error);
    return {
      draft: undefined,
      checked: { issues: [issue], result: undefined },
      wiki: base,
      attempt: {
        draft: undefined,
        issues: [issue],
        usage: error.usage,
        cached: false,
        toolCalls: 0,
      },
    };
  }
}

function sum(attempts: readonly UnitAttempt[]): {
  usage: TipUsage;
  toolCalls: number;
} {
  return {
    usage: attempts.reduce((total, entry) => addUsage(total, entry.usage), {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
    }),
    toolCalls: attempts.reduce((total, entry) => total + entry.toolCalls, 0),
  };
}

async function generateWithRetry<Draft, Result>(input: {
  env: UnitEnvironment;
  request: TipPrompt;
  schema: z.ZodType<Draft>;
  schemaName: string;
  prefetched: PrefetchedWiki | undefined;
  hashFor: (wiki: WikiRevisions) => string;
  check: UnitCheck<Draft, Result>;
}): Promise<UnitOutcome<Result>> {
  const shared = {
    env: input.env,
    system: input.request.system,
    schema: input.schema,
    schemaName: input.schemaName,
    prefetched: input.prefetched,
    hashFor: input.hashFor,
    check: input.check,
  };
  const first = await attemptOnce({
    ...shared,
    prompt: input.request.prompt,
  });
  if (first.checked.result !== undefined) {
    return {
      status: "ok",
      result: first.checked.result,
      firstAttemptIssues: [],
      attempts: [first.attempt],
      wiki: first.wiki,
      ...sum([first.attempt]),
    };
  }
  const second = await attemptOnce({
    ...shared,
    prompt: buildRetryPrompt({
      prompt: input.request.prompt,
      rejected: first.draft,
      issues: first.checked.issues,
    }),
  });
  const attempts = [first.attempt, second.attempt];
  if (second.checked.result !== undefined) {
    return {
      status: "ok",
      result: second.checked.result,
      firstAttemptIssues: first.checked.issues,
      attempts,
      wiki: second.wiki,
      ...sum(attempts),
    };
  }
  return {
    status: "dropped",
    issues: second.checked.issues,
    firstAttemptIssues: first.checked.issues,
    attempts,
    wiki: second.wiki,
    ...sum(attempts),
  };
}

export type MatchupUnitInput = {
  lane: Lane;
  /** Lower champion id first; the first champion's tips are `forward`. */
  championIds: readonly [ChampionId, ChampionId];
  groundings: readonly [ChampionGrounding, ChampionGrounding];
  general?: readonly GeneralTipSet[] | undefined;
};

export function matchupUnitHash(
  promptVersion: string,
  input: Pick<MatchupUnitInput, "lane" | "championIds" | "groundings">,
  extras: TipHashExtras,
): string {
  return computeTipInputHash(
    promptVersion,
    { kind: "matchup", lane: input.lane, championIds: input.championIds },
    input.groundings,
    extras,
  );
}

export function generalUnitHash(
  promptVersion: string,
  lane: Lane,
  grounding: ChampionGrounding,
  extras: TipHashExtras,
): string {
  return computeTipInputHash(
    promptVersion,
    { kind: "general", lane, championIds: [grounding.championId] },
    [grounding],
    extras,
  );
}

export async function generateMatchupUnit(
  env: UnitEnvironment,
  input: MatchupUnitInput,
): Promise<UnitOutcome<MatchupResult>> {
  const [first, second] = input.groundings;
  const prefetched =
    env.wiki === undefined
      ? undefined
      : await prefetchChampionWiki(env.wiki, [first.name, second.name]);
  const [firstNotes, secondNotes] = prefetched?.notes ?? [];
  return generateWithRetry({
    env,
    request: buildMatchupPrompt({
      lane: input.lane,
      first,
      second,
      glossary: env.glossary,
      notes:
        firstNotes === undefined || secondNotes === undefined
          ? undefined
          : [firstNotes, secondNotes],
    }),
    schema: MatchupDraftSchema,
    schemaName: MATCHUP_SCHEMA_NAME,
    prefetched,
    hashFor: (wiki) =>
      matchupUnitHash(env.promptVersion, input, {
        wiki,
        groundingVersion: CURRENT_GROUNDING_VERSION,
      }),
    check: (draft, stamp) =>
      checkMatchupDraft({
        env,
        lane: input.lane,
        groundings: input.groundings,
        inputHash: stamp.inputHash,
        wiki: stamp.wiki,
        draft,
        general: input.general,
      }),
  });
}

export async function generateGeneralUnit(
  env: UnitEnvironment,
  input: { lane: Lane; grounding: ChampionGrounding },
): Promise<UnitOutcome<GeneralResult>> {
  const prefetched =
    env.wiki === undefined
      ? undefined
      : await prefetchChampionWiki(env.wiki, [input.grounding.name]);
  return generateWithRetry({
    env,
    request: buildGeneralPrompt({
      lane: input.lane,
      champion: input.grounding,
      glossary: env.glossary,
      notes: prefetched?.notes[0],
    }),
    schema: GeneralDraftSchema,
    schemaName: GENERAL_SCHEMA_NAME,
    prefetched,
    hashFor: (wiki) =>
      generalUnitHash(env.promptVersion, input.lane, input.grounding, {
        wiki,
        groundingVersion: CURRENT_GROUNDING_VERSION,
      }),
    check: (draft, stamp) =>
      checkGeneralDraft({
        env,
        lane: input.lane,
        grounding: input.grounding,
        inputHash: stamp.inputHash,
        wiki: stamp.wiki,
        draft,
      }),
  });
}
