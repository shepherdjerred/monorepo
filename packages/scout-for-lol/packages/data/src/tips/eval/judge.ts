import { z } from "zod";
import { laneToString, type Lane } from "#src/model/riot/lane.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import {
  type TipModel,
  type TipUsage,
  type WikiLookup,
  addUsage,
} from "#src/tips/model.ts";
import {
  TipSourceSchema,
  describeChampion,
  knownSources,
} from "#src/tips/prompt.ts";
import type { WikiRevisions } from "#src/tips/schema.ts";

/**
 * The rubric judge. A separate model reads the same grounding the generator
 * saw (including the wiki ability notes) and may look further pages up on the
 * League of Legends Wiki before it scores each tip of a generated unit. The
 * validators check names, cites and style; only a judge can say whether a tip
 * is true and worth reading. Used by the eval only, never by the generator.
 *
 * Two judges from different model families score every unit so no model grades
 * its own work alone; the report shows where they agree.
 */

export const JUDGE_PROMPT_VERSION = "judge-2";
export const JUDGE_SCHEMA_NAME = "scout_tip_verdicts";

export const CorrectnessSchema = z.enum(["correct", "wrong", "not-checkable"]);
export type Correctness = z.infer<typeof CorrectnessSchema>;

export const TipVerdictSchema = z.strictObject({
  correctness: CorrectnessSchema,
  /** A player of this champion in this lane or matchup would act on it. */
  useful: z.boolean(),
  /** Plain words a casual player understands. */
  plain: z.boolean(),
  /** One line: the fact that decides the correctness, or why it is not useful. */
  reason: z.string().min(1),
  /** The sources the verdict rests on. */
  sources: z.array(TipSourceSchema),
});
export type TipVerdict = z.infer<typeof TipVerdictSchema>;

export const JudgeDraftSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      correctness: CorrectnessSchema,
      useful: z.boolean(),
      plain: z.boolean(),
      reason: z.string(),
      sources: z.array(z.string()),
    }),
  ),
});

const JUDGE_SYSTEM_PROMPT = `You review short League of Legends tips written for casual players. You are given the facts the writer worked from (each champion's abilities with cooldown, cost and range by rank, resolved ability descriptions, aiming and missile mechanics from CommunityDragon, roles, Riot's own tips, the champion's changes in the recent patches, and the champion's ability notes from the official League of Legends Wiki) and the tips to judge. Judge each tip on three questions.

correctness
- "correct": every claim about the champions' abilities and how they interact is supported by the facts or the wiki notes.
- "wrong": the facts or the wiki contradict a claim, or the tip gives an ability an effect they do not describe (the wrong target, range, duration, resource, or a mechanic the text rules out). Name the contradicting fact in the reason.
- "not-checkable": the claim depends on something neither the facts, the notes nor the wiki say, such as spacing, timing or general game sense.
- A tip with one wrong claim is "wrong" even if the rest is right.
- Look things up before you call a tip "wrong" or "not-checkable". The "lookup" tool reads any page of the official League of Legends Wiki by title: an item, a status such as "Slow" or "Airborne", a mechanic such as "Minion", or another champion. Check how a projectile treats minions, what a status does, what an ability is blocked by. Judge from what the wiki says, not from memory; if the wiki does not say, the tip is "not-checkable", not "wrong".

useful
- true when a player of the named champion in this lane or matchup would do something differently because of the tip. false when it is vague, obvious, true of every champion, written for the wrong side of the matchup, or gives advice that cannot be followed.

plain
- true when a casual player understands it at first read: short, concrete, no jargon, no stat talk. false otherwise.

Return one verdict per tip, in the order given, with "index" as the tip's number. "reason" is one short line. "sources" lists the sources your correctness verdict rests on, from "ability-facts" (the numbers and descriptions), "mechanics" (the CommunityDragon aiming and missile data), "patch-changes" (the recent changes), "riot-tips", "wiki-notes" (the notes given up front), "wiki-lookup" (a page you looked up), and "general-knowledge" (nothing given or looked up decided it).`;

/** One set of tips under judgment: who it is for, and the tip texts. */
export type JudgedSet = {
  subject: ChampionGrounding;
  /** The opponent, for a matchup set; absent for general tips. */
  opponent?: ChampionGrounding | undefined;
  tips: readonly string[];
};

export type JudgeInput = {
  lane: Lane;
  /** The sets of one generation unit: both directions of a pair, or one general set. */
  sets: readonly JudgedSet[];
  /** Wiki ability notes by champion name. */
  notes?: ReadonlyMap<string, string> | undefined;
  lookup?: WikiLookup | undefined;
};

function setHeading(set: JudgedSet, lane: Lane, label: string): string {
  return set.opponent === undefined
    ? `${label}: general tips for the player of ${set.subject.name} in ${laneToString(lane)} lane.`
    : `${label}: matchup tips for the player of ${set.subject.name} against ${set.opponent.name} in ${laneToString(lane)} lane.`;
}

export type JudgePrompt = {
  system: string;
  /** The anchor champion's block: shared by the units that include that champion. */
  prefix: string;
  rest: string;
  prompt: string;
};

export type JudgePromptOptions = {
  /** The champion whose block leads, so units of one champion share a prefix. */
  anchor?: string | undefined;
  /** Put every champion block in the prefix, for a unit judged several times. */
  shareAll?: boolean | undefined;
};

export function buildJudgePrompt(
  input: JudgeInput,
  options: JudgePromptOptions = {},
): JudgePrompt {
  const { anchor } = options;
  const champions = new Map<string, ChampionGrounding>();
  for (const set of input.sets) {
    champions.set(set.subject.name, set.subject);
    if (set.opponent !== undefined) {
      champions.set(set.opponent.name, set.opponent);
    }
  }
  const ordered = [...champions.values()].toSorted(
    (left, right) =>
      Number(right.name === anchor) - Number(left.name === anchor),
  );
  let index = 0;
  const sections = input.sets.flatMap((set, position) => {
    const label = `Set ${String.fromCodePoint(65 + position)}`;
    const tips = set.tips.map((text) => {
      const line = `${index.toString()}. ${text}`;
      index += 1;
      return line;
    });
    return [setHeading(set, input.lane, label), ...tips, ""];
  });
  const blocks = ordered.map((grounding) =>
    describeChampion("Champion", grounding, input.notes?.get(grounding.name)),
  );
  const [first = "", ...others] = blocks;
  const prefix = options.shareAll === true ? blocks.join("\n\n") : first;
  const rest = [
    ...(options.shareAll === true
      ? []
      : others.flatMap((block) => [block, ""])),
    "Tips to judge (numbered across the sets):",
    ...sections,
  ].join("\n");
  return {
    system: JUDGE_SYSTEM_PROMPT,
    prefix,
    rest,
    prompt: `${prefix}\n\n${rest}`,
  };
}

function verdictProblems(
  draft: z.infer<typeof JudgeDraftSchema>,
  count: number,
): string[] {
  const problems: string[] = [];
  if (draft.verdicts.length !== count) {
    problems.push(
      `expected ${count.toString()} verdicts, got ${draft.verdicts.length.toString()}`,
    );
  }
  for (const [position, verdict] of draft.verdicts.entries()) {
    if (verdict.index !== position) {
      problems.push(
        `verdict ${position.toString()} has index ${verdict.index.toString()}`,
      );
    }
    if (verdict.reason.trim() === "") {
      problems.push(`verdict ${position.toString()} has no reason`);
    }
  }
  return problems;
}

export type JudgedUnit = {
  /** One list of verdicts per input set, in order. */
  verdicts: TipVerdict[][];
  usage: TipUsage;
  toolCalls: number;
  /** Wiki pages the judge looked up. */
  lookedUp: WikiRevisions;
};

/**
 * Judge one unit. A verdict list that does not line up with the tips gets one
 * retry naming the problem; a second miss throws, because a half-scored eval
 * would quietly skew every rate.
 */
export async function judgeUnit(
  model: TipModel,
  input: JudgeInput,
  maxOutputTokens: number,
): Promise<JudgedUnit> {
  const { system, prompt } = buildJudgePrompt(input);
  const count = input.sets.reduce((total, set) => total + set.tips.length, 0);
  let usage: TipUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
  };
  let toolCalls = 0;
  const lookedUp: Record<string, number> = {};
  let note = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await model.generate({
      system,
      prompt: `${prompt}${note}`,
      schema: JudgeDraftSchema,
      schemaName: JUDGE_SCHEMA_NAME,
      maxOutputTokens,
      lookup: input.lookup,
    });
    usage = addUsage(usage, answer.usage);
    toolCalls += answer.toolCalls;
    Object.assign(lookedUp, answer.lookedUp);
    const problems = verdictProblems(answer.object, count);
    if (problems.length === 0) {
      const flat = answer.object.verdicts.map((verdict) =>
        TipVerdictSchema.parse({
          correctness: verdict.correctness,
          useful: verdict.useful,
          plain: verdict.plain,
          reason: verdict.reason.trim(),
          sources: knownSources(verdict.sources),
        }),
      );
      let from = 0;
      const verdicts = input.sets.map((set) => {
        const slice = flat.slice(from, from + set.tips.length);
        from += set.tips.length;
        return slice;
      });
      return { verdicts, usage, toolCalls, lookedUp };
    }
    note = `\n\nYour previous answer was rejected: ${problems.join("; ")}. Return one verdict per tip, numbered from 0.`;
  }
  throw new Error(
    `the judge did not return one verdict per tip for ${input.sets.map((set) => set.subject.name).join(" / ")}`,
  );
}
