/**
 * Vision judging of builds from their judge sheets (mc-build
 * `renderJudgeSheet`: hero, plan, value and normal views, fixed close-ups,
 * and only a letter for a title).
 *
 * Two questions, kept apart because they measure different things:
 * - `judgePair`: which of two builds is better. Asked twice with the order
 *   swapped; a disagreement is a tie, which cancels position bias. No scores
 *   come back from this call — a preference is more sensitive than a score,
 *   and mixing the two lets one leak into the other.
 * - `scoreAbsolute`: one build on a rubric, 0–5 per axis, with the overall
 *   aesthetic question asked last and separately so it cannot halo the
 *   functional axes (the GDMC judging finding).
 *
 * Verdicts are persisted under `<build dir>/judge/` when the target is a
 * build directory, so a build's history of judgments survives the session.
 */
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
} from "@shepherdjerred/mc-build/render/index.ts";
import {
  createLlmRuntime,
  generateValidatedObject,
  providerCredentialsFromEnv,
  requireCredentialsFor,
  type LlmImageInput,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import {
  BUILD_FILES,
  JudgeRubricSchema,
  type JudgeRecord,
  type JudgeRubric,
} from "#protocol/build.ts";
import { BuildWorkspace } from "./workspace.ts";

/**
 * OpenAI's flagship vision model (image input, structured outputs). Override
 * with --model; llm-runtime resolves the provider credential.
 */
export const DEFAULT_JUDGE_MODEL = "gpt-6.1-sol";

export type RubricAxis = { id: string; text: string };

/**
 * Axes are listed functional first and look last, and the model is told to
 * answer them in order. The wording matches the building skill's rubric.md
 * and maps.md so the agent and the judge argue about the same things.
 */
export const RUBRICS: Record<
  JudgeRubric,
  { subject: string; axes: readonly RubricAxis[] }
> = {
  micro: {
    subject: "one building",
    axes: [
      {
        id: "lighting",
        text: "no dark interiors visible; light sources present and placed with intent",
      },
      {
        id: "siteFit",
        text: "sits on the terrain with no floating corners or dirt showing under walls; a path to the door; landscaping",
      },
      {
        id: "proportion",
        text: "doors 2 high, ceilings at least 3, windows in rhythm with posts; compare to the player silhouette",
      },
      {
        id: "palette",
        text: "3–5 related blocks ordered by value; frame contrasts infill; roof distinct from walls",
      },
      {
        id: "texture",
        text: "large surfaces mixed with purpose (gradients, weathering), not flat single blocks and not confetti",
      },
      {
        id: "depth",
        text: "at least one block of wall relief: proud posts or beams, recessed openings, sills, eaves; see the NORMAL panel",
      },
      {
        id: "detail",
        text: "lanterns, flower boxes, fences, chimneys at a sensible density, densest at the entrance, not on every surface",
      },
      {
        id: "silhouette",
        text: "varied roofline and massing, not one box with one ridge; reads from every angle; see the VALUE panel",
      },
    ],
  },
  map: {
    subject: "a settlement or landscape",
    axes: [
      {
        id: "relief",
        text: "the ground has real relief (hills, cliffs, valleys), not a flat plate or a single smooth cone",
      },
      {
        id: "terrain",
        text: "surfaces follow the landform: rock on steep faces, mixed ground cover, natural water edges, no contour banding",
      },
      {
        id: "edges",
        text: "buildings meet the ground with foundations or retaining walls; roads follow contours without steps; no flattened plots",
      },
      {
        id: "openSpace",
        text: "30–40% of the ground is unbuilt: plazas, fields, gardens, water; roofs do not read as one blob",
      },
      {
        id: "life",
        text: "lived-in details in moderation: lamps along roads, carts, crops, docks, props with a purpose",
      },
      {
        id: "variety",
        text: "buildings vary in size, roof and palette within one style; no grid of identical houses; props repeat with variants",
      },
      {
        id: "focalPoint",
        text: "one landmark on the highest or most exposed spot with a clear sight line; composition leads the eye to it",
      },
      {
        id: "palette",
        text: "a coherent map-wide palette with contrast between ground, roofs and walls; not grey-dominant",
      },
    ],
  },
};

export function rubricAxisIds(rubric: JudgeRubric): string[] {
  return RUBRICS[rubric].axes.map((axis) => axis.id);
}

const SHEET_NOTE =
  "Each image is a judge sheet: a textured HERO view, a PLAN (top) view, the same hero in VALUE (grays: tonal massing and silhouette) and NORMAL (every face coloured by its facing: a flat wall is one flat colour, relief shows as colour changes), and CLOSE panels at twice the scale for detail. Judge only what is visible.";

/** What the model returns for one ordered comparison. */
export const PairVerdictSchema = z.strictObject({
  winner: z.enum(["first", "second", "tie"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1).max(4),
});
export type PairVerdict = z.infer<typeof PairVerdictSchema>;

export type JudgeVerdict = {
  winner: "a" | "b" | "tie";
  confidence: number;
  agreed: boolean;
  /** Each ordering's reasons, prefixed with which build came first. */
  reasons: string[];
  model: string;
};

/** Asks the model about two images in the given order. */
export type AskJudge = (
  first: LlmImageInput,
  second: LlmImageInput,
) => Promise<PairVerdict>;

export function pairPrompt(rubric: JudgeRubric): string {
  const { subject, axes } = RUBRICS[rubric];
  return `You are judging two Minecraft builds, each ${subject}, from their judge sheets. The first image is build FIRST, the second is build SECOND. ${SHEET_NOTE}

Weigh these, in this order:
${axes.map((axis) => `- ${axis.id}: ${axis.text}`).join("\n")}

Pick the better build overall, or "tie" only if they are genuinely equal. Give your confidence 0–1 and up to four short, concrete reasons that name which build each applies to and which panel shows it.`;
}

/**
 * Judges `a` vs `b` twice (a first, then b first). Agreement keeps the winner
 * with the mean confidence; disagreement is a tie with zero confidence.
 */
// Bump this contract whenever judgePair's calls or aggregation policy changes:
// tournament caches store the aggregated verdict, not the individual answers.
const PAIR_AGGREGATION_POLICY =
  "v1:two-swapped-orders;disagreement=tie/zero;agreement=winner/mean-confidence";

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
  return {
    winner: agreed ? forwardWinner : "tie",
    confidence: agreed ? (forward.confidence + reverse.confidence) / 2 : 0,
    agreed,
    reasons: [
      ...forward.reasons.map((line) => `(a first) ${line}`),
      ...reverse.reasons.map((line) => `(b first) ${line}`),
    ],
    model,
  };
}

const score5 = z.number().int().min(0).max(5);

/** The model's answer for one build on one rubric. */
export function absoluteSchema(rubric: JudgeRubric) {
  return z.strictObject({
    axes: z.strictObject(
      Object.fromEntries(rubricAxisIds(rubric).map((id) => [id, score5])),
    ),
    overallAesthetic: score5,
    notes: z.array(z.string().min(1)).min(1).max(5),
  });
}
export type AbsoluteAnswer = {
  axes: Record<string, number>;
  overallAesthetic: number;
  notes: string[];
};

export type AbsoluteScores = AbsoluteAnswer & {
  rubric: JudgeRubric;
  /** Sum over the axes (not the aesthetic question); max is 5 × axes. */
  total: number;
  max: number;
  model: string;
};

/** Asks the model about one image. */
export type AskScore = (image: LlmImageInput) => Promise<AbsoluteAnswer>;

export function absolutePrompt(rubric: JudgeRubric): string {
  const { subject, axes } = RUBRICS[rubric];
  return `You are scoring one Minecraft build, ${subject}, from its judge sheet. ${SHEET_NOTE}

Score each axis 0–5 (0 absent, 3 competent, 5 would pass for a professional build team's work), answering them strictly in this order and judging each on its own evidence:
${axes.map((axis) => `- ${axis.id}: ${axis.text}`).join("\n")}

Only after all axes are scored, answer overallAesthetic 0–5: would a player screenshot this? Then list up to five short notes naming the most costly defect first, each with the panel that shows it.`;
}

/** The lowest-scoring axis, first in rubric order on a tie. */
export function lowestAxis(
  rubric: JudgeRubric,
  axes: Record<string, number>,
): string {
  const [first, ...others] = rubricAxisIds(rubric);
  if (first === undefined) throw new Error(`rubric ${rubric} has no axes`);
  return others.reduce(
    (lowest, id) => ((axes[id] ?? 0) < (axes[lowest] ?? 0) ? id : lowest),
    first,
  );
}

export async function scoreAbsolute(
  image: LlmImageInput,
  ask: AskScore,
  options: { rubric: JudgeRubric; model: string },
): Promise<AbsoluteScores> {
  const answer = await ask(image);
  const ids = rubricAxisIds(options.rubric);
  const total = ids.reduce((sum, id) => sum + (answer.axes[id] ?? 0), 0);
  return {
    ...answer,
    rubric: options.rubric,
    total,
    max: 5 * ids.length,
    model: options.model,
  };
}

/** The llm-runtime a judge or critic call goes through; fails fast without the provider's credentials. */
export function judgeRuntime(model: string): LlmRuntime {
  const credentials = providerCredentialsFromEnv();
  requireCredentialsFor(model, credentials);
  return createLlmRuntime({
    credentials,
    service: "mc-harness",
    appName: "Minecraft build judge",
  });
}

/** A real model behind `AskJudge`; fails fast without the provider's credentials. */
export function llmJudge(
  model: string,
  rubric: JudgeRubric = "micro",
): AskJudge {
  const runtime = judgeRuntime(model);
  const prompt = pairPrompt(rubric);
  return async (first, second) => {
    const result = await generateValidatedObject(runtime, {
      model,
      schema: PairVerdictSchema,
      schemaName: "build_pair_judgement",
      prompt,
      images: [first, second],
      workload: "mc-harness.build.judge",
    });
    return result.object;
  };
}

/** A real model behind `AskScore`; fails fast without the provider's credentials. */
export function llmScorer(model: string, rubric: JudgeRubric): AskScore {
  const runtime = judgeRuntime(model);
  const prompt = absolutePrompt(rubric);
  const schema = absoluteSchema(rubric);
  return async (image) => {
    const result = await generateValidatedObject(runtime, {
      model,
      schema,
      schemaName: "build_absolute_score",
      prompt,
      images: [image],
      workload: "mc-harness.build.score",
    });
    return result.object;
  };
}

/** Renders the judge sheet a directory target is judged by; injectable so tests need no assets. */
export type SheetRenderer = (
  grid: BlockGrid,
  rubric: JudgeRubric,
) => Promise<Uint8Array>;

async function defaultSheet(
  grid: BlockGrid,
  rubric: JudgeRubric,
): Promise<Uint8Array> {
  const renderer = new Renderer(await ensureAssets());
  const image = await renderer.judgeSheet(grid, { kind: rubric, label: "X" });
  assertTexturesPresent(renderer, `judge sheet (${rubric})`);
  return new Uint8Array(await encodePng(image));
}

/**
 * The image a judge sees for a target: a PNG as given (the caller vouches
 * that it is a judge sheet), or, for a build directory, a judge sheet of the
 * rubric rendered from the frozen canvas result (`expected.json`, written by
 * `build run`) and written as `judge/sheet-<rubric>-<grid hash>-<image
 * hash>.png`. The image hash makes the file content-addressed: a changed
 * renderer, layout or texture set writes a new file, and every older
 * `judge/*.json` record keeps pointing at the pixels it was judged on. The
 * sheet is what the prompts describe, so a directory is never judged by
 * whichever render happens to be newest.
 */
export async function resolveRender(
  target: string,
  options: { rubric: JudgeRubric; sheet?: SheetRenderer },
): Promise<string> {
  const info = await stat(target);
  if (info.isFile()) {
    if (!target.endsWith(".png")) {
      throw new Error(`${target} is not a PNG judge sheet`);
    }
    return target;
  }
  const workspace = new BuildWorkspace(target);
  const grid = await workspace.expected();
  const image = await (options.sheet ?? defaultSheet)(grid, options.rubric);
  const imageHash = createHash("sha256").update(image).digest("hex");
  const file = workspace.file(
    path.join(
      BUILD_FILES.judgeDir,
      `sheet-${options.rubric}-${gridHash(grid).slice(0, 12)}-${imageHash.slice(0, 12)}.png`,
    ),
  );
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, image);
  return file;
}

/**
 * What the judge was asked, as a short hash: the pair prompt for the rubric
 * and the shape of the answer. Cached verdicts are keyed by it, so a changed
 * prompt, schema or aggregation policy never reuses an old verdict.
 */
/** The same for the absolute scorer: its prompt and the axes it answers. */
export function scoreFingerprint(rubric: JudgeRubric): string {
  return createHash("sha256")
    .update(absolutePrompt(rubric))
    .update(schemaContract(absoluteSchema(rubric)))
    .digest("hex")
    .slice(0, 12);
}

export function judgeFingerprint(rubric: JudgeRubric): string {
  return createHash("sha256")
    .update(pairPrompt(rubric))
    .update(schemaContract(PairVerdictSchema))
    .update(PAIR_AGGREGATION_POLICY)
    .digest("hex")
    .slice(0, 12);
}

/**
 * The whole answer contract as JSON Schema (field names, enums, ranges,
 * array bounds), so a tightened or widened answer is a new judge even when
 * the field names stay the same.
 */
function schemaContract(schema: z.ZodType): string {
  return JSON.stringify(z.toJSONSchema(schema));
}

export async function pngInput(file: string): Promise<LlmImageInput> {
  return {
    data: new Uint8Array(await Bun.file(file).arrayBuffer()),
    mediaType: "image/png",
  };
}

/** Freeze exactly the external pixels sent to the model beside its record. */
async function archivePng(dir: string, image: LlmImageInput): Promise<string> {
  const hash = createHash("sha256").update(image.data).digest("hex");
  const file = path.join(
    path.resolve(dir),
    BUILD_FILES.judgeDir,
    `input-${hash}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, image.data);
  return file;
}

async function isBuildDir(target: string): Promise<boolean> {
  const info = await stat(target);
  return info.isDirectory();
}

/** Persists a verdict under `<dir>/judge/<kind>-<timestamp>.json`; returns the file. */
export async function writeJudgeRecord(
  dir: string,
  record: JudgeRecord,
): Promise<string> {
  const judgeDir = path.join(dir, BUILD_FILES.judgeDir);
  await mkdir(judgeDir, { recursive: true });
  const stamp = record.at.replaceAll(/[:.]/gu, "-");
  const file = path.join(judgeDir, `${record.kind}-${stamp}.json`);
  await Bun.write(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function parseRubric(value = "micro"): JudgeRubric {
  return JudgeRubricSchema.parse(value);
}

/**
 * CLI entry: resolves both renders and judges them. When `a` is a build
 * directory the verdict is also written under its `judge/` directory.
 */
export async function judgeRenders(
  a: string,
  b: string,
  options: {
    model: string;
    rubric?: JudgeRubric;
    ask?: AskJudge;
    sheet?: SheetRenderer;
  },
): Promise<
  JudgeVerdict & { renders: { a: string; b: string }; record: string | null }
> {
  const rubric = options.rubric ?? "micro";
  const resolve = {
    rubric,
    ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
  };
  const renders = {
    a: await resolveRender(a, resolve),
    b: await resolveRender(b, resolve),
  };
  const images = {
    a: await pngInput(renders.a),
    b: await pngInput(renders.b),
  };
  const persist = await isBuildDir(a);
  if (persist && !(await isBuildDir(b))) {
    renders.b = await archivePng(a, images.b);
  }
  const ask = options.ask ?? llmJudge(options.model, rubric);
  const verdict = await judgePair(images.a, images.b, ask, options.model);
  const record = persist
    ? await writeJudgeRecord(a, {
        kind: "pair",
        at: new Date().toISOString(),
        model: options.model,
        rubric,
        judge: judgeFingerprint(rubric),
        a: renders.a,
        b: renders.b,
        winner: verdict.winner,
        confidence: verdict.confidence,
        agreed: verdict.agreed,
        reasons: verdict.reasons,
      })
    : null;
  return { ...verdict, renders, record };
}

/**
 * CLI entry: scores one render on a rubric. When `target` is a build
 * directory the scores are also written under its `judge/` directory.
 */
export async function scoreRender(
  target: string,
  options: {
    model: string;
    rubric: JudgeRubric;
    ask?: AskScore;
    sheet?: SheetRenderer;
  },
): Promise<AbsoluteScores & { render: string; record: string | null }> {
  const render = await resolveRender(target, {
    rubric: options.rubric,
    ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
  });
  const ask = options.ask ?? llmScorer(options.model, options.rubric);
  const scores = await scoreAbsolute(await pngInput(render), ask, options);
  const record = (await isBuildDir(target))
    ? await writeJudgeRecord(target, {
        kind: "absolute",
        at: new Date().toISOString(),
        model: options.model,
        rubric: options.rubric,
        judge: scoreFingerprint(options.rubric),
        render,
        axes: scores.axes,
        overallAesthetic: scores.overallAesthetic,
        total: scores.total,
        max: scores.max,
        notes: scores.notes,
      })
    : null;
  return { ...scores, render, record };
}
