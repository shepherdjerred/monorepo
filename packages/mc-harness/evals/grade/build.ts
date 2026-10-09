import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type Box, RegionReadResponseSchema } from "#protocol/bridge.ts";
import { BuildManifestSchema, type JudgeRubric } from "#protocol/build.ts";
import type { GradeCheck, Grader, JudgeSummary } from "#evals/lib/types.ts";
import { deliveredChecks, type DeliveredSpec } from "#evals/grade/delivered.ts";
import { judgeNote } from "#evals/grade/judge-note.ts";
import { sandboxFrom } from "#evals/grade/tower.ts";
import { mergeRegionReads, tileBox } from "#build/tiles.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import {
  gridFromRegionRead,
  type BlockGrid,
} from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";

const LintJsonSchema = z.object({
  ok: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
});
const VerifyJsonSchema = z.object({ mismatches: z.number() });

function lastJson(stdout: string): unknown {
  const start = stdout.indexOf("{");
  return start === -1 ? null : JSON.parse(stdout.slice(start));
}

/**
 * Renders a library entry's program as a judge sheet of the same kind as the
 * agent's, lettered "B" so the pair is anonymised like for like.
 */
async function referenceRender(
  ctx: Parameters<Grader>[0],
  slug: string,
  rubric: JudgeRubric,
): Promise<string | null> {
  const out = path.join(ctx.taskDir, `reference-${slug}.png`);
  const sheet = path.join(ctx.taskDir, `reference-${slug}-judge.png`);
  const run = await ctx.exec([
    process.execPath,
    "run",
    path.join(ctx.worktree, "packages", "mc-build", "scripts", "render.ts"),
    path.join(
      ctx.worktree,
      "packages",
      "mc-build",
      "library",
      slug,
      "build.ts",
    ),
    out,
    "--judge-sheet",
    sheet,
    "--kind",
    rubric,
    "--label",
    "B",
  ]);
  return run.exitCode === 0 ? sheet : null;
}

/** The library reference render plus the judge's verdict, when both renders exist. */
async function judgeAgainstLibrary(
  ctx: Parameters<Grader>[0],
  png: string,
  slug: string,
  rubric: JudgeRubric,
): Promise<{
  artifacts: string[];
  notes: string[];
  judge: JudgeSummary | null;
}> {
  if (!(await Bun.file(png).exists())) {
    return { artifacts: [], notes: [], judge: null };
  }
  const reference = await referenceRender(ctx, slug, rubric);
  if (reference === null) {
    return {
      artifacts: [],
      notes: [`no reference render for library/${slug}`],
      judge: null,
    };
  }
  const { note, verdict } = await judgeNote({
    render: png,
    reference: { slug, render: reference },
    rubric,
  });
  return {
    artifacts: [reference],
    notes: [note],
    judge:
      verdict === null
        ? null
        : {
            reference: `library/${slug}`,
            winner:
              verdict.winner === "a"
                ? "agent"
                : verdict.winner === "b"
                  ? "reference"
                  : "tie",
            confidence: verdict.confidence,
            agreed: verdict.agreed,
            model: verdict.model,
          },
  };
}

/**
 * Reads the promoted site in tiles (map-scale sites exceed one bridge
 * snapshot) and renders its contact sheet and hero view.
 */
async function renderPromoted(
  ctx: Parameters<Grader>[0],
  sandbox: string,
  siteBox: Box,
  rubric: JudgeRubric,
): Promise<{
  grid: BlockGrid;
  png: string;
  hero: string;
  judgeSheet: string;
  check: GradeCheck;
}> {
  const parts = [];
  for (const tile of tileBox(siteBox)) {
    parts.push(
      await ctx.daemon.request(
        RegionReadResponseSchema,
        "POST",
        `/targets/${sandbox}/region-read`,
        tile,
      ),
    );
  }
  const promoted = gridFromRegionRead(mergeRegionReads(siteBox, parts));
  const registry = await loadRegistry();
  const schem = path.join(ctx.taskDir, "promoted-site.schem");
  const png = path.join(ctx.taskDir, "promoted-site.png");
  const hero = path.join(ctx.taskDir, "promoted-hero.png");
  const judgeSheet = path.join(ctx.taskDir, "promoted-judge.png");
  await Bun.write(schem, writeSchematic(promoted, registry.dataVersion));
  const render = await ctx.exec([
    process.execPath,
    "run",
    path.join(ctx.worktree, "packages", "mc-build", "scripts", "render.ts"),
    schem,
    png,
    "--hero",
    hero,
    "--judge-sheet",
    judgeSheet,
    "--kind",
    rubric,
  ]);
  return {
    grid: promoted,
    png,
    hero,
    judgeSheet,
    check: {
      name: "grader rendered the promoted site",
      pass: render.exitCode === 0 && (await Bun.file(png).exists()),
      detail: render.exitCode === 0 ? png : render.stderr.slice(0, 300),
    },
  };
}

/**
 * The captured site (`site/site.schem`) the delivered checks measure against,
 * so untouched ground is neither built nor repetition. A missing or
 * mismatched capture is a failed check, and the checks then run on the
 * promoted grid alone.
 */
async function capturedSite(
  buildDir: string,
  promoted: BlockGrid,
): Promise<{ site: BlockGrid | null; check: GradeCheck }> {
  const name = "delivered checks measure against the captured site";
  try {
    const workspace = new BuildWorkspace(buildDir);
    const manifest = await workspace.manifest();
    const site = await workspace.siteGrid();
    const sameSize =
      site.size.x === promoted.size.x &&
      site.size.y === promoted.size.y &&
      site.size.z === promoted.size.z;
    // build.json records the hash of the capture; a site.schem rewritten
    // since is not the baseline the build was made on.
    const recorded = manifest.site?.siteHash ?? null;
    const hash = gridHash(site);
    const sameHash = recorded !== null && hash === recorded;
    const size = `${site.size.x.toString()}×${site.size.y.toString()}×${site.size.z.toString()}`;
    const hashDetail =
      recorded === null
        ? "build.json records no site capture"
        : sameHash
          ? `site/site.schem ${size}, hash ${hash.slice(0, 12)}`
          : `site/site.schem hash ${hash.slice(0, 12)} is not the capture build.json records (${recorded.slice(0, 12)})`;
    const detail = sameSize
      ? hashDetail
      : `site/site.schem is ${size}, promoted box is ${promoted.size.x.toString()}×${promoted.size.y.toString()}×${promoted.size.z.toString()}`;
    const pass = sameSize && sameHash;
    return { site: pass ? site : null, check: { name, pass, detail } };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      site: null,
      check: { name, pass: false, detail: reason.slice(0, 300) },
    };
  }
}

/** The delivered checks for a task that has an `expect` spec, measured against the captured site. */
async function deliveredSection(
  buildDir: string,
  grid: BlockGrid,
  options: {
    expect?: DeliveredSpec;
    lintWarnings: number | null;
    /** Where the captured site is copied (`captured-site.schem`) for the bench to measure against. */
    taskDir: string;
  },
): Promise<GradeCheck[]> {
  if (options.expect === undefined) return [];
  const captured = await capturedSite(buildDir, grid);
  const copy = path.join(options.taskDir, "captured-site.schem");
  if (captured.site === null) {
    // A copy left by an earlier grade of this task directory would let the
    // bench measure against a site this build was not promoted over.
    await rm(copy, { force: true });
  } else {
    await cp(path.join(buildDir, "site", "site.schem"), copy);
  }
  return [
    captured.check,
    ...deliveredChecks(
      grid,
      options.expect,
      options.lintWarnings,
      captured.site ?? undefined,
    ),
  ];
}

/**
 * Build tasks: the promoted build must verify against its expected snapshot,
 * lint clean on the source world, and deliver what the task asked for
 * (`expect`: scale, features, warning and repetition limits). The grader
 * renders the promoted site itself, including the judge sheet the bench
 * rates. When a vision credential is configured, the pairwise judge also
 * compares the render with a library reference and records the verdict;
 * looks never decide pass/fail here — the bench does that.
 */
export const buildGrader =
  (options: {
    reference: string;
    rubric: JudgeRubric;
    expect?: DeliveredSpec;
  }): Grader =>
  async (ctx) => {
    const referenceSlug = options.reference;
    const checks: GradeCheck[] = [];
    const artifacts: string[] = [];
    const notes: string[] = [];
    const sandbox = sandboxFrom(ctx, "sourceSandbox");
    const buildDirValue = ctx.result?.["buildDir"];
    const applyId = ctx.result?.["applyId"];
    if (
      sandbox === null ||
      typeof buildDirValue !== "string" ||
      typeof applyId !== "string"
    ) {
      return {
        checks: [
          {
            name: "result.json names sourceSandbox, buildDir and applyId",
            pass: false,
            detail: JSON.stringify(ctx.result),
          },
        ],
        artifacts,
        notes,
      };
    }
    const buildDir = path.resolve(ctx.worktree, buildDirValue);
    const finalPng = path.join(ctx.outDir, "final.png");
    checks.push({
      name: "agent delivered OUT/final.png",
      pass: await Bun.file(finalPng).exists(),
      detail: finalPng,
    });
    if (await Bun.file(finalPng).exists()) {
      artifacts.push(finalPng);
    }

    const verify = await ctx.toolkit([
      "mc",
      "build",
      "verify",
      applyId,
      "--json",
    ]);
    const verified = VerifyJsonSchema.safeParse(lastJson(verify.stdout));
    checks.push({
      name: "promote verifies with 0 mismatches",
      pass:
        verify.exitCode === 0 &&
        verified.success &&
        verified.data.mismatches === 0,
      detail: verified.success
        ? `${String(verified.data.mismatches)} mismatch(es)`
        : verify.stderr.slice(0, 300),
    });

    const lint = await ctx.toolkit([
      "mc",
      "build",
      "lint",
      buildDir,
      "--target",
      sandbox,
      "--json",
    ]);
    const linted = LintJsonSchema.safeParse(lastJson(lint.stdout));
    checks.push({
      name: "promoted build lints with 0 errors",
      pass: linted.success && linted.data.errors === 0,
      detail: linted.success
        ? `${String(linted.data.errors)} error(s), ${String(linted.data.warnings)} warning(s)`
        : lint.stderr.slice(0, 300),
    });

    const manifest = BuildManifestSchema.safeParse(
      JSON.parse(
        await Bun.file(path.join(buildDir, "build.json"))
          .text()
          .catch(() => "null"),
      ),
    );
    if (!manifest.success || manifest.data.site === undefined) {
      checks.push({
        name: "build.json has a captured site",
        pass: false,
        detail: buildDir,
      });
      return { checks, artifacts, notes };
    }
    const { site, world } = manifest.data;
    const { grid, png, hero, judgeSheet, check } = await renderPromoted(
      ctx,
      sandbox,
      { world, min: site.min, max: site.max },
      options.rubric,
    );
    checks.push(check);
    for (const file of [png, hero, judgeSheet]) {
      if (await Bun.file(file).exists()) {
        artifacts.push(file);
      }
    }
    checks.push(
      ...(await deliveredSection(buildDir, grid, {
        ...(options.expect === undefined ? {} : { expect: options.expect }),
        lintWarnings: linted.success ? linted.data.warnings : null,
        taskDir: ctx.taskDir,
      })),
    );
    const critique = ctx.result?.["selfCritique"];
    if (typeof critique === "string") {
      notes.push(`self-critique: ${critique}`);
    }
    notes.push(
      "Looks are rated by the bench (evals/bench) from the judge sheet; the library comparison below is a single pairwise verdict.",
    );
    const judged = await judgeAgainstLibrary(
      ctx,
      judgeSheet,
      referenceSlug,
      options.rubric,
    );
    artifacts.push(...judged.artifacts);
    notes.push(...judged.notes);
    return { checks, artifacts, notes, judge: judged.judge };
  };
