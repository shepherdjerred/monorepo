/**
 * Optional aesthetics signal for E2/E5: the pairwise vision judge compares the
 * grader's render of the promoted build against a library reference render.
 * It only adds a note — looks never decide pass/fail, and a missing vision
 * credential skips it with the reason.
 */
import {
  DEFAULT_JUDGE_MODEL,
  judgePair,
  llmJudge,
  pngInput,
  type AskJudge,
  type JudgeVerdict,
} from "#build/judge.ts";
import type { JudgeRubric } from "#protocol/build.ts";

export async function judgeNote(options: {
  render: string;
  reference: { slug: string; render: string };
  model?: string;
  /** Which rubric the pair prompt argues about; micro unless the task is a map. */
  rubric?: JudgeRubric;
  /** Builds the judge; defaults to the real model (fails without credentials). */
  makeAsk?: (model: string, rubric: JudgeRubric) => AskJudge;
}): Promise<{ note: string; verdict: JudgeVerdict | null }> {
  const model = options.model ?? DEFAULT_JUDGE_MODEL;
  const rubric = options.rubric ?? "micro";
  let ask: AskJudge;
  try {
    ask = (options.makeAsk ?? llmJudge)(model, rubric);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { note: `judge skipped: ${reason}`, verdict: null };
  }
  const verdict = await judgePair(
    await pngInput(options.render),
    await pngInput(options.reference.render),
    ask,
    model,
  );
  const outcome =
    verdict.winner === "tie"
      ? "tie"
      : verdict.winner === "a"
        ? "agent build wins"
        : `library/${options.reference.slug} wins`;
  return {
    note: `judge vs library/${options.reference.slug} (${model}): ${outcome}, confidence ${verdict.confidence.toFixed(2)}${verdict.agreed ? "" : " (orderings disagreed)"}; ${verdict.reasons.join(" / ")}`,
    verdict,
  };
}
