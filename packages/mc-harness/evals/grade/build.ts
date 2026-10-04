import path from "node:path";
import { z } from "zod";
import { SnapshotSchema } from "#protocol/bridge.ts";
import { BuildManifestSchema } from "#protocol/build.ts";
import { SnapshotBytesResponseSchema } from "#protocol/ipc.ts";
import type { GradeCheck, Grader } from "#evals/lib/types.ts";
import { judgeNote } from "#evals/grade/judge-note.ts";
import { sandboxFrom } from "#evals/grade/tower.ts";

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

/** Renders a library entry's program for the judge's reference image. */
async function referenceRender(
  ctx: Parameters<Grader>[0],
  slug: string,
): Promise<string | null> {
  const out = path.join(ctx.taskDir, `reference-${slug}.png`);
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
  ]);
  return run.exitCode === 0 ? out : null;
}

/** The library reference render plus the judge's note, when both renders exist. */
async function judgeAgainstLibrary(
  ctx: Parameters<Grader>[0],
  png: string,
  slug: string,
): Promise<{ artifacts: string[]; notes: string[] }> {
  if (!(await Bun.file(png).exists())) {
    return { artifacts: [], notes: [] };
  }
  const reference = await referenceRender(ctx, slug);
  if (reference === null) {
    return {
      artifacts: [],
      notes: [`no reference render for library/${slug}`],
    };
  }
  const note = await judgeNote({
    render: png,
    reference: { slug, render: reference },
  });
  return { artifacts: [reference], notes: [note] };
}

/**
 * E2/E5: the promoted build must verify against its expected snapshot and
 * lint clean on the source world; the grader renders the promoted site
 * itself so a human can judge the looks (aesthetics are not auto-graded).
 * When a vision credential is configured, the pairwise judge also compares
 * that render with a library reference and records the verdict as a note.
 */
export const buildGrader =
  (referenceSlug: string): Grader =>
  async (ctx) => {
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
    const snapshot = await ctx.daemon.request(
      SnapshotSchema,
      "POST",
      `/targets/${sandbox}/snapshot`,
      {
        box: { world, min: site.min, max: site.max },
        label: "eval-grade",
      },
    );
    const bytes = await ctx.daemon.request(
      SnapshotBytesResponseSchema,
      "GET",
      `/targets/${sandbox}/snapshots/${snapshot.id}`,
    );
    const schem = path.join(ctx.taskDir, "promoted-site.schem");
    const png = path.join(ctx.taskDir, "promoted-site.png");
    await Bun.write(schem, Buffer.from(bytes.base64, "base64"));
    const render = await ctx.exec([
      process.execPath,
      "run",
      path.join(ctx.worktree, "packages", "mc-build", "scripts", "render.ts"),
      schem,
      png,
    ]);
    checks.push({
      name: "grader rendered the promoted site",
      pass: render.exitCode === 0 && (await Bun.file(png).exists()),
      detail: render.exitCode === 0 ? png : render.stderr.slice(0, 300),
    });
    if (await Bun.file(png).exists()) {
      artifacts.push(png);
    }
    const critique = ctx.result?.["selfCritique"];
    if (typeof critique === "string") {
      notes.push(`self-critique: ${critique}`);
    }
    notes.push(
      "Aesthetics are judged by a human from the rendered contact sheet.",
    );
    const judged = await judgeAgainstLibrary(ctx, png, referenceSlug);
    artifacts.push(...judged.artifacts);
    notes.push(...judged.notes);
    return { checks, artifacts, notes };
  };
