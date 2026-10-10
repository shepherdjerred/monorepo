/**
 * The commands that call a vision model: `judge`, `critique` and
 * `candidate knockout`. They load judge.ts lazily, because it pulls in
 * llm-runtime and the built model catalog, so every other build command
 * works in a fresh checkout.
 */
import { print, type Handler } from "#build/command-kit.ts";
import type * as JudgeModule from "#build/judge.ts";

type Values = {
  json: boolean;
  model?: string;
  rubric?: string;
  absolute: boolean;
  render?: string;
  stage?: string;
  scores?: string;
  note?: string[];
};

export async function loadJudge(): Promise<typeof JudgeModule> {
  try {
    return await import("#build/judge.ts");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("@shepherdjerred/llm-models")) {
      throw new Error(
        "this command needs the built model catalog; run `bunx turbo run build --filter=@shepherdjerred/llm-models` once, then retry",
        { cause: error },
      );
    }
    throw error;
  }
}

export const JUDGE_USAGE = `  critique <dir> [--render <name>] [--rubric micro|map] [--stage visual|code|both] [--model id]
                                        Blind critic scores the render's judge sheet 0–5 per axis, then reviews build.ts for ranked changes
  critique <dir> --scores "axis=n,…,aesthetic=n" [--note "…"]...
                                        Record scores given by eye (no model credential needed), in the same shape`;

const STAGES = ["visual", "code", "both"] as const;

export const JUDGE_HANDLERS: Record<string, Handler<Values>> = {
  critique: async (_env, dir, values) => {
    const [judge, critique] = await Promise.all([
      loadJudge(),
      import("./critique.ts"),
    ]);
    const stage = STAGES.find((name) => name === values.stage);
    if (stage === undefined && values.stage !== undefined) {
      throw new Error(
        `--stage must be one of ${STAGES.join("|")} (got "${values.stage}")`,
      );
    }
    const rubric = judge.parseRubric(values.rubric);
    const result = await critique.critiqueBuild(dir, {
      ...(values.render === undefined ? {} : { render: values.render }),
      ...(stage === undefined ? {} : { stage }),
      ...(values.scores === undefined
        ? {}
        : {
            byEye: critique.parseByEye(
              rubric,
              values.scores,
              values.note ?? [],
            ),
          }),
      rubric,
      model: values.model ?? judge.DEFAULT_JUDGE_MODEL,
    });
    print(values.json, result, critique.renderCritique(result));
    return 0;
  },
  judge: async (_env, a, values, rest) => {
    const judge = await loadJudge();
    const model = values.model ?? judge.DEFAULT_JUDGE_MODEL;
    const rubric = judge.parseRubric(values.rubric);
    if (values.absolute) {
      const scores = await judge.scoreRender(a, { model, rubric });
      print(
        values.json,
        scores,
        [
          `score (${scores.model}, ${scores.rubric}): ${scores.total.toString()}/${scores.max.toString()}, aesthetic ${scores.overallAesthetic.toString()}/5`,
          `  render = ${scores.render}`,
          ...judge
            .rubricAxisIds(rubric)
            .map(
              (id) =>
                `  ${id.padEnd(13)} ${(scores.axes[id] ?? 0).toString()}/5`,
            ),
          ...scores.notes.map((line) => `  - ${line}`),
          ...(scores.record === null ? [] : [`  record = ${scores.record}`]),
        ].join("\n"),
      );
      return 0;
    }
    const [b] = rest;
    if (b === undefined) {
      throw new Error(
        "judge needs two renders: toolkit mc build judge <a> <b>",
      );
    }
    const verdict = await judge.judgeRenders(a, b, { model, rubric });
    print(
      values.json,
      verdict,
      [
        `judge (${verdict.model}, ${rubric}): ${verdict.winner === "tie" ? "tie" : `${verdict.winner} wins`} — confidence ${verdict.confidence.toFixed(2)}${verdict.agreed ? "" : " (orderings disagreed)"}`,
        `  a = ${verdict.renders.a}`,
        `  b = ${verdict.renders.b}`,
        ...verdict.reasons.map((line) => `  - ${line}`),
        ...(verdict.record === null ? [] : [`  record = ${verdict.record}`]),
      ].join("\n"),
    );
    return 0;
  },
};
