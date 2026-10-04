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
} from "#build/judge.ts";

export async function judgeNote(options: {
  render: string;
  reference: { slug: string; render: string };
  model?: string;
  /** Builds the judge; defaults to the real model (fails without credentials). */
  makeAsk?: (model: string) => AskJudge;
}): Promise<string> {
  const model = options.model ?? DEFAULT_JUDGE_MODEL;
  let ask: AskJudge;
  try {
    ask = (options.makeAsk ?? llmJudge)(model);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return `judge skipped: ${reason}`;
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
  return `judge vs library/${options.reference.slug} (${model}): ${outcome}, confidence ${verdict.confidence.toFixed(2)}; rubric totals agent ${verdict.totals.a.toString()}/16, reference ${verdict.totals.b.toString()}/16${verdict.agreed ? "" : " (orderings disagreed)"}`;
}
