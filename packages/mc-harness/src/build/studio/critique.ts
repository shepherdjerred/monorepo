/**
 * `build critique`: a blind look at one render, then (with the program) a
 * code review ranked by the lowest-scoring axes. The critic sees a judge
 * sheet lettered "X", never the build's name, notes or program; the code
 * stage is a second call that gets the scores, lint and `build.ts`, so what
 * the picture showed decides what the program review looks for.
 *
 * Everything persists: `judge/critique-<ts>-<hash>.{png,json}`, the journal, and
 * the render's sidecar `scores`, so `resume` and `candidate` can read them.
 */
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
} from "@shepherdjerred/mc-build/render/index.ts";
import {
  BUILD_FILES,
  type CodeSuggestion,
  type JudgeRubric,
  type RenderSidecar,
} from "#protocol/build.ts";
import { readLog } from "#build/build-log.ts";
import {
  judgeRuntime,
  llmScorer,
  lowestAxis,
  rubricAxisIds,
  RUBRICS,
  scoreAbsolute,
  judgeFingerprint,
  type AbsoluteScores,
  type AskScore,
} from "#build/judge.ts";
import {
  latestRenderName,
  buildArtifactPath,
  readProgramText,
  readSidecar,
} from "#build/sidecar.ts";
import { savedRender } from "#build/sources.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { reuseVisual, type Visual } from "./visual-result.ts";
import { publishCritique, critiqueRequestKey } from "./critique-publication.ts";

/** What the code stage is given: the visual verdict and the program. */
export type CodeInput = {
  rubric: JudgeRubric;
  scores: AbsoluteScores;
  lowest: string;
  lint: string[];
  program: string;
};
export type AskCode = (
  input: CodeInput,
) => Promise<{ suggestions: CodeSuggestion[] }>;

export type CritiqueStage = "visual" | "code" | "both";

/** Scores given by eye, in the rubric's shape, when no model credential is available. */
export type ByEye = {
  axes: Record<string, number>;
  overallAesthetic: number;
  notes: string[];
};

/** The "model" a by-eye critique is recorded under. */
export const BY_EYE = "by-eye";

export type CritiqueOptions = {
  /** A render name under `renders/`; default the latest. */
  render?: string;
  rubric: JudgeRubric;
  model: string;
  /** Default: `both` when the build has a program, else `visual`. */
  stage?: CritiqueStage;
  ask?: AskScore;
  askCode?: AskCode;
  /** Record these scores instead of asking a model; the stage is visual only. */
  byEye?: ByEye;
};

/**
 * Parses `--scores "axis=n,…,aesthetic=n"` for a by-eye critique: every axis
 * of the rubric and `aesthetic`, each 0–5, nothing else.
 */
export function parseByEye(
  rubric: JudgeRubric,
  scores: string,
  notes: readonly string[],
): ByEye {
  const ids = rubricAxisIds(rubric);
  const given = new Map<string, number>();
  for (const part of scores.split(",")) {
    const [key, value, ...rest] = part.trim().split("=");
    const score = Number(value);
    if (
      key === undefined ||
      value === undefined ||
      rest.length > 0 ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > 5
    ) {
      throw new Error(
        `--scores entries are axis=0..5 (got "${part.trim()}"); axes for ${rubric}: ${ids.join(", ")}, aesthetic`,
      );
    }
    given.set(key.trim(), score);
  }
  const expected = new Set([...ids, "aesthetic"]);
  const missing = [...expected].filter((id) => !given.has(id));
  const unknown = [...given.keys()].filter((id) => !expected.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `--scores needs every axis of ${rubric} and aesthetic${missing.length === 0 ? "" : `; missing ${missing.join(", ")}`}${unknown.length === 0 ? "" : `; unknown ${unknown.join(", ")}`}`,
    );
  }
  return {
    axes: Object.fromEntries(ids.map((id) => [id, given.get(id) ?? 0])),
    overallAesthetic: given.get("aesthetic") ?? 0,
    notes: notes.map((note) => note.trim()).filter((note) => note.length > 0),
  };
}

/** `AbsoluteScores` from by-eye scores: the same totals a model's answer gets. */
function byEyeScores(rubric: JudgeRubric, byEye: ByEye): AbsoluteScores {
  const ids = rubricAxisIds(rubric);
  return {
    axes: byEye.axes,
    overallAesthetic: byEye.overallAesthetic,
    notes: byEye.notes,
    rubric,
    total: ids.reduce((sum, id) => sum + (byEye.axes[id] ?? 0), 0),
    max: 5 * ids.length,
    model: BY_EYE,
  };
}

export type CritiqueResult = {
  render: string;
  iteration: number;
  sheet: string;
  record: string;
  scores: AbsoluteScores;
  lowest: string;
  suggestions: CodeSuggestion[];
  /** Whether the code stage ran. */
  reviewedProgram: boolean;
};

/** Up to this much of build.ts goes to the code stage. */
export const PROGRAM_LIMIT = 24 * 1024;

function codeSchema(rubric: JudgeRubric) {
  const [first, ...others] = rubricAxisIds(rubric);
  if (first === undefined) throw new Error(`rubric ${rubric} has no axes`);
  return z.strictObject({
    suggestions: z
      .array(
        z.strictObject({
          axis: z.enum([first, ...others]),
          change: z.string().min(1),
          where: z.string().min(1),
        }),
      )
      .min(1)
      .max(5),
  });
}

export function codePrompt(input: CodeInput): string {
  const { axes } = RUBRICS[input.rubric];
  const scored = axes
    .map(
      (axis) =>
        `- ${axis.id} ${(input.scores.axes[axis.id] ?? 0).toString()}/5: ${axis.text}`,
    )
    .join("\n");
  return `A critic scored a Minecraft build from its render, without seeing this program. You now see the program (mc-build DSL, build.ts) that produced it and the critic's verdict. Propose up to five concrete changes to the program, ranked by expected gain, starting with the lowest axis (${input.lowest}). Each change names the axis it serves, says in one sentence what to change, and says where in the program (a function, a helper call, or a line range). Do not restate the scores; do not suggest changes the critic's notes do not support.

Scores (0 absent, 3 competent, 5 professional):
${scored}
Overall aesthetic ${input.scores.overallAesthetic.toString()}/5.

Critic's notes:
${input.scores.notes.map((note) => `- ${note}`).join("\n")}

Lint:
${input.lint.length === 0 ? "- clean" : input.lint.map((line) => `- ${line}`).join("\n")}

Program:
\`\`\`ts
${input.program}
\`\`\``;
}

/** A real model behind `AskCode`; fails fast without the provider's credentials. */
export function llmCodeReviewer(model: string): AskCode {
  const runtime = judgeRuntime(model);
  return async (input) => {
    const result = await generateValidatedObject(runtime, {
      model,
      schema: codeSchema(input.rubric),
      schemaName: "build_code_review",
      prompt: codePrompt(input),
      workload: "mc-harness.build.critique",
    });
    return result.object;
  };
}

/** The program that produced the render, kept beside it, or null when it was made without one. */
async function programFor(
  workspace: BuildWorkspace,
  sidecar: RenderSidecar,
): Promise<string | null> {
  if (sidecar.program === null) return null;
  const text = await readProgramText(workspace, sidecar.program);
  return text.length > PROGRAM_LIMIT
    ? `${text.slice(0, PROGRAM_LIMIT)}\n// … truncated at ${PROGRAM_LIMIT.toString()} bytes`
    : text;
}

async function lintLines(
  workspace: BuildWorkspace,
  name: string,
): Promise<string[]> {
  const registry = await loadRegistry();
  const grid = await savedRender(workspace, name);
  const report = lintGrid(grid, { registry });
  return report.findings
    .slice(0, 20)
    .map(
      (finding) => `${finding.severity} ${finding.code}: ${finding.message}`,
    );
}

async function reviewProgram(
  options: CritiqueOptions,
  input: CodeInput,
): Promise<CodeSuggestion[]> {
  const ask = options.askCode ?? llmCodeReviewer(options.model);
  const answer = await ask(input);
  return answer.suggestions;
}

/** Draws the judge sheet of the render and scores it, by model or by eye. */
async function scoreVisual(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  options: CritiqueOptions,
  stamp: string,
): Promise<Visual> {
  const renderer = new Renderer(await ensureAssets());
  const judgeSheet = await renderer.judgeSheet(grid, {
    kind: options.rubric,
    label: "X",
  });
  assertTexturesPresent(renderer, `critique sheet (${options.rubric})`);
  const image = await encodePng(judgeSheet);
  const sheetHash = createHash("sha256").update(image).digest("hex");
  const sheet = path.join(
    BUILD_FILES.judgeDir,
    `critique-${stamp}-${sheetHash}.png`,
  );
  await Bun.write(workspace.file(sheet), image);
  if (options.byEye !== undefined) {
    return {
      sheet,
      sheetHash,
      scores: byEyeScores(options.rubric, options.byEye),
      model: BY_EYE,
    };
  }
  const scores = await scoreAbsolute(
    { data: new Uint8Array(image), mediaType: "image/png" },
    options.ask ?? llmScorer(options.model, options.rubric),
    { rubric: options.rubric, model: options.model },
  );
  return { sheet, sheetHash, scores, model: options.model };
}

export async function critiqueBuild(
  dir: string,
  options: CritiqueOptions,
): Promise<CritiqueResult> {
  const workspace = new BuildWorkspace(dir);
  const journal = await readLog(dir);
  const name = options.render ?? (await latestRenderName(workspace, journal));
  const sidecar = await readSidecar(workspace, name);
  // Settle the stage before any sheet is drawn or a model is paid for.
  const program = await programFor(workspace, sidecar);
  if (options.byEye !== undefined && (options.stage ?? "visual") !== "visual") {
    throw new Error(
      "a by-eye critique (--scores) has no code stage; drop --stage or use --stage visual",
    );
  }
  const stage =
    options.stage ??
    (program === null || options.byEye !== undefined ? "visual" : "both");
  if (stage === "code" && program === null) {
    throw new Error(
      `render "${name}" was made without a ${BUILD_FILES.program}, so there is no program to review; use --stage visual`,
    );
  }
  const grid = await savedRender(workspace, name);
  const hash = gridHash(grid);
  if (hash !== sidecar.gridHash) {
    throw new Error(
      `render "${name}" schematic hash ${hash} does not match sidecar ${sidecar.gridHash}; render it again before critique`,
    );
  }
  const key = critiqueRequestKey({
    name,
    iteration: sidecar.iteration,
    at: sidecar.at,
    hash,
    program,
    rubric: options.rubric,
    model: options.model,
    stage,
    byEye: options.byEye,
    policy: judgeFingerprint(options.rubric),
    visual:
      stage === "code"
        ? journal.findLast(
            (entry) =>
              entry.kind === "critique" &&
              entry.render === name &&
              entry.gridHash === hash &&
              entry.iteration === sidecar.iteration &&
              entry.rubric === options.rubric,
          )
        : undefined,
  });
  const { record, verdict } = await publishCritique(
    workspace,
    { key, sidecar, visual: stage !== "code", rubric: options.rubric },
    async (pending) => {
      const at = new Date().toISOString();
      const stamp = at.replaceAll(/[:.]/gu, "-");
      const { sheet, sheetHash, scores, model } =
        stage === "code"
          ? await reuseVisual(workspace, journal, {
              name,
              sidecar,
              rubric: options.rubric,
            })
          : await scoreVisual(pending, grid, options, stamp);
      if (stage === "code")
        await Bun.write(
          pending.file(sheet),
          await Bun.file(await buildArtifactPath(workspace, sheet)).bytes(),
        );
      const lowest = lowestAxis(options.rubric, scores.axes);

      const review = stage === "visual" || program === null ? null : program;
      const suggestions =
        review === null
          ? []
          : await reviewProgram(options, {
              rubric: options.rubric,
              scores,
              lowest,
              lint: await lintLines(workspace, name),
              program: review,
            });

      const gridFile = path.join(
        BUILD_FILES.judgeDir,
        "grids",
        `${randomUUID()}.schem`,
      );
      const registry = await loadRegistry();
      await Bun.write(
        pending.file(gridFile),
        writeSchematic(grid, registry.dataVersion),
      );
      return {
        kind: "critique",
        at,
        iteration: sidecar.iteration,
        model: stage === "code" ? options.model : model,
        visualModel: model,
        rubric: options.rubric,
        render: name,
        sheet,
        sheetHash,
        grid: gridFile,
        gridHash: hash,
        axes: scores.axes,
        overallAesthetic: scores.overallAesthetic,
        total: scores.total,
        max: scores.max,
        lowest,
        notes: scores.notes,
        suggestions,
      };
    },
  );
  return {
    render: name,
    iteration: verdict.iteration,
    sheet: verdict.sheet,
    record,
    scores: {
      rubric: verdict.rubric,
      model: verdict.visualModel ?? verdict.model,
      axes: verdict.axes,
      overallAesthetic: verdict.overallAesthetic,
      notes: verdict.notes,
      total: verdict.total,
      max: verdict.max,
    },
    lowest: verdict.lowest,
    suggestions: verdict.suggestions,
    reviewedProgram: stage !== "visual" && program !== null,
  };
}

/** The human form, in the shape rubric.md asks critiques to be written in. */
export function renderCritique(result: CritiqueResult): string {
  const ids = rubricAxisIds(result.scores.rubric);
  const scored = ids
    .map((id) => `${id} ${(result.scores.axes[id] ?? 0).toString()}`)
    .join(", ");
  return [
    `iteration ${result.iteration.toString()} (${result.render}): ${scored} — total ${result.scores.total.toString()}/${result.scores.max.toString()}, aesthetic ${result.scores.overallAesthetic.toString()}/5`,
    `lowest: ${result.lowest} (${(result.scores.axes[result.lowest] ?? 0).toString()})`,
    ...result.scores.notes.map((note) => `  - ${note}`),
    ...(result.reviewedProgram
      ? [
          "changes, best first:",
          ...result.suggestions.map(
            (item, index) =>
              `  ${(index + 1).toString()}. [${item.axis}] ${item.change} — ${item.where}`,
          ),
        ]
      : ["changes: not reviewed (no program, or --stage visual)"]),
    `sheet = ${result.sheet}`,
    `record = ${result.record}`,
  ].join("\n");
}
