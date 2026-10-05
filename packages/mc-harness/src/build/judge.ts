/**
 * Pairwise aesthetic judge: a vision model compares two contact-sheet renders
 * against the building rubric. Each pair is judged twice with the order
 * swapped; a disagreement is a tie, which cancels position bias.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  createLlmRuntime,
  generateValidatedObject,
  providerCredentialsFromEnv,
  requireCredentialsFor,
  type LlmImageInput,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import { BUILD_FILES } from "#protocol/build.ts";

/**
 * OpenAI's flagship vision model (image input, structured outputs). Override
 * with --model; llm-runtime resolves the provider credential.
 */
export const DEFAULT_JUDGE_MODEL = "gpt-6.1-sol";

export const RUBRIC_DIMENSIONS = [
  "silhouette",
  "depth",
  "palette",
  "texture",
  "proportion",
  "detail",
  "siteFit",
  "lighting",
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

const score = z.number().int().min(0).max(2);
const DimensionScoresSchema = z.strictObject({
  silhouette: score,
  depth: score,
  palette: score,
  texture: score,
  proportion: score,
  detail: score,
  siteFit: score,
  lighting: score,
} satisfies Record<RubricDimension, z.ZodNumber>);
export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

/** What the model returns for one ordered comparison. */
export const ModelVerdictSchema = z.strictObject({
  winner: z.enum(["first", "second", "tie"]),
  confidence: z.number().min(0).max(1),
  first: DimensionScoresSchema,
  second: DimensionScoresSchema,
  critique: z.array(z.string().min(1)).min(1).max(6),
});
export type ModelVerdict = z.infer<typeof ModelVerdictSchema>;

export type JudgeVerdict = {
  winner: "a" | "b" | "tie";
  confidence: number;
  agreed: boolean;
  scores: { a: DimensionScores; b: DimensionScores };
  totals: { a: number; b: number };
  critique: string[];
  model: string;
};

/** Asks the model about two images in the given order. */
export type AskJudge = (
  first: LlmImageInput,
  second: LlmImageInput,
) => Promise<ModelVerdict>;

const JUDGE_PROMPT = `You are judging two Minecraft builds from their contact sheets (four isometric views, two elevations, a top view, and block stats). The first image is build FIRST, the second is build SECOND.

Score each build 0–2 on every rubric dimension:
- silhouette: varied roofline, not a box; reads from every angle
- depth: at least one block of wall relief (proud posts/beams, recessed panels, sills, overhangs)
- palette: 3–5 related blocks; frame contrasts infill; roof distinct
- texture: large surfaces mixed, not flat single blocks
- proportion: doors 2 high, ceilings ≥3, windows in rhythm (compare to the player silhouette)
- detail: lanterns, flower boxes, fences, chimneys at a sensible density
- siteFit: sits on the terrain, path to the door, landscaping
- lighting: no dark interiors visible; light sources present

Then pick the better build overall (or "tie" only if they are genuinely equal), give your confidence 0–1, and list up to six short, concrete critique points naming which build each applies to. Judge only what is visible.`;

function totalOf(scores: DimensionScores): number {
  return RUBRIC_DIMENSIONS.reduce(
    (sum, dimension) => sum + scores[dimension],
    0,
  );
}

function averageScores(
  x: DimensionScores,
  y: DimensionScores,
): DimensionScores {
  const entries = RUBRIC_DIMENSIONS.map(
    (dimension) =>
      [dimension, Math.round((x[dimension] + y[dimension]) / 2)] as const,
  );
  return DimensionScoresSchema.parse(Object.fromEntries(entries));
}

/**
 * Judges `a` vs `b` twice (a first, then b first). Agreement keeps the winner
 * with the mean confidence; disagreement is a tie with zero confidence.
 */
export async function judgePair(
  a: LlmImageInput,
  b: LlmImageInput,
  ask: AskJudge,
  model: string,
): Promise<JudgeVerdict> {
  const forward = await ask(a, b);
  const reverse = await ask(b, a);
  const forwardWinner =
    forward.winner === "first"
      ? "a"
      : forward.winner === "second"
        ? "b"
        : "tie";
  const reverseWinner =
    reverse.winner === "first"
      ? "b"
      : reverse.winner === "second"
        ? "a"
        : "tie";
  const agreed = forwardWinner === reverseWinner;
  const scores = {
    a: averageScores(forward.first, reverse.second),
    b: averageScores(forward.second, reverse.first),
  };
  return {
    winner: agreed ? forwardWinner : "tie",
    confidence: agreed ? (forward.confidence + reverse.confidence) / 2 : 0,
    agreed,
    scores,
    totals: { a: totalOf(scores.a), b: totalOf(scores.b) },
    critique: [
      ...forward.critique.map((line) => `(a first) ${line}`),
      ...reverse.critique.map((line) => `(b first) ${line}`),
    ],
    model,
  };
}

/** A real model behind `AskJudge`; fails fast without the provider's credentials. */
export function llmJudge(model: string): AskJudge {
  const credentials = providerCredentialsFromEnv();
  requireCredentialsFor(model, credentials);
  const runtime = createLlmRuntime({
    credentials,
    service: "mc-harness",
    appName: "Minecraft build judge",
  });
  return async (first, second) => {
    const result = await generateValidatedObject(runtime, {
      model,
      schema: ModelVerdictSchema,
      schemaName: "build_judgement",
      prompt: JUDGE_PROMPT,
      images: [first, second],
      workload: "mc-harness.build.judge",
    });
    return result.object;
  };
}

/** A contact sheet PNG, or a build directory's most recent render. */
export async function resolveRender(target: string): Promise<string> {
  const info = await stat(target);
  if (info.isFile()) {
    if (!target.endsWith(".png")) {
      throw new Error(`${target} is not a PNG contact sheet`);
    }
    return target;
  }
  const dir = path.join(target, BUILD_FILES.rendersDir);
  const names = await readdir(dir);
  const pngs = names.filter((name) => name.endsWith(".png"));
  if (pngs.length === 0) {
    throw new Error(`${dir} has no renders; run toolkit mc build render first`);
  }
  const dated = await Promise.all(
    pngs.map(async (name) => {
      const file = path.join(dir, name);
      const fileStat = await stat(file);
      return { file, mtime: fileStat.mtimeMs };
    }),
  );
  dated.sort((x, y) => y.mtime - x.mtime);
  const [latest] = dated;
  if (latest === undefined) throw new Error(`${dir} has no renders`);
  return latest.file;
}

export async function pngInput(file: string): Promise<LlmImageInput> {
  return {
    data: new Uint8Array(await Bun.file(file).arrayBuffer()),
    mediaType: "image/png",
  };
}

/** CLI entry: resolves both renders and judges them with the given model. */
export async function judgeRenders(
  a: string,
  b: string,
  options: { model: string; ask?: AskJudge },
): Promise<JudgeVerdict & { renders: { a: string; b: string } }> {
  const renders = { a: await resolveRender(a), b: await resolveRender(b) };
  const ask = options.ask ?? llmJudge(options.model);
  const verdict = await judgePair(
    await pngInput(renders.a),
    await pngInput(renders.b),
    ask,
    options.model,
  );
  return { ...verdict, renders };
}
