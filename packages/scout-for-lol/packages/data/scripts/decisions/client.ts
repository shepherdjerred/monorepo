// The Decisions API judge, through the repository's LLM runtime
// (`runtime.decide`): one request per unit, two questions per tip, the unit's
// grounding as a cached prefix. It has no tool use, so it judges from the
// prefetched grounding and wiki notes alone.

import {
  createLlmRuntime,
  providerCredentialsFromEnv,
} from "@shepherdjerred/llm-runtime";
import type { TipScores } from "#src/tips/eval/decisions.ts";
import type { JudgePrompt } from "#src/tips/eval/judge.ts";

export const DECISION_MODEL = "gpt-6-luna";

const DECISION_SYSTEM = `You review short League of Legends tips written for casual players. The facts the writer worked from come first: each champion's abilities with cooldown, cost and range by rank, resolved descriptions, aiming and missile mechanics, roles, Riot's own tips, recent patch changes, and the champion's ability notes from the official League of Legends Wiki. Then come numbered tips. For each tip you are asked whether its claims are correct, wrong or not checkable, and whether it is useful.
- correct: every claim about the champions' abilities and how they interact is supported by the facts or the notes.
- wrong: the facts or the notes contradict a claim, or give an ability an effect they do not describe (the wrong target, range, duration, resource, or a mechanic the text rules out). A tip with one wrong claim is wrong.
- not-checkable: the claim depends on something the facts and the notes do not say. Use only what is given; do not rely on outside knowledge.
- useful: a player of the named champion in this lane or matchup would do something differently because of the tip; not vague, obvious, or true of every champion.`;

export type DecisionTipInput = {
  /** The tip's number in the prompt, from 0. */
  index: number;
  text: string;
  /** Who the tip is for, for the question. */
  subject: string;
  opponent?: string | undefined;
};

export type DecisionUnitResult = {
  /** One score per tip, in tip order. */
  scores: TipScores[];
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  milliseconds: number;
};

const CHOICES = [
  { value: "correct" },
  { value: "wrong" },
  { value: "not-checkable" },
];

export function createTipDecisions() {
  const runtime = createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
    service: "scout-data",
    appName: "scout-tips-decisions/1.0",
  });

  /** Judge one unit's tips: the shared grounding is the cached prefix, the tips follow. */
  async function judgeUnit(
    prompt: JudgePrompt,
    tips: readonly DecisionTipInput[],
  ): Promise<DecisionUnitResult> {
    const questions = tips.flatMap((tip) => {
      const who =
        tip.opponent === undefined
          ? `the player of ${tip.subject}`
          : `the player of ${tip.subject} against ${tip.opponent}`;
      return [
        {
          type: "choice" as const,
          name: `c${tip.index.toString()}`,
          instructions: `Tip ${tip.index.toString()} is written for ${who}. Are its claims correct, wrong or not checkable from the facts and notes above?`,
          choices: CHOICES,
        },
        {
          type: "predicate" as const,
          name: `u${tip.index.toString()}`,
          instructions: `Is tip ${tip.index.toString()} useful to ${who}: would they do something differently because of it?`,
        },
      ];
    });
    const started = performance.now();
    const result = await runtime.decide({
      model: DECISION_MODEL,
      workload: "scout.tips.decisions",
      // The API has no `system` parameter (the runtime's field is rejected
      // with a 400) and takes the cache breakpoint as an object, not the
      // runtime's boolean, so the instructions go in a developer message and
      // the grounding leads for the implicit prefix cache.
      input: [
        { role: "developer", content: DECISION_SYSTEM },
        {
          role: "user",
          content: [
            { type: "input_text", text: `${prompt.prefix}\n\n` },
            { type: "input_text", text: prompt.rest },
          ],
        },
      ],
      questions,
    });
    const milliseconds = Math.round(performance.now() - started);
    const scores = tips.map((tip): TipScores => {
      const choice = result.answerByName(`c${tip.index.toString()}`);
      const useful = result.answerByName(`u${tip.index.toString()}`);
      if (choice?.type !== "choice" || useful?.type !== "predicate") {
        throw new Error(
          `the Decisions API did not answer tip ${tip.index.toString()} (${choice?.type ?? "none"}, ${useful?.type ?? "none"})`,
        );
      }
      const p = (value: string): number =>
        choice.probabilities.find((entry) => entry.value === value)
          ?.probability ?? 0;
      return {
        pCorrect: p("correct"),
        pWrong: p("wrong"),
        pNotCheckable: p("not-checkable"),
        pUseful: useful.probability,
      };
    });
    if (result.catalogCostUsd === undefined) {
      throw new Error(`no Decisions price on file for ${DECISION_MODEL}`);
    }
    return {
      scores,
      costUsd: result.catalogCostUsd,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      milliseconds,
    };
  }

  return { judgeUnit };
}
