import path from "node:path";
import { publishFiles } from "#build/file-transaction.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { keepBuildRecord } from "#evals/lib/build-record.ts";
import type { GradeCheck, GradeContext } from "#evals/lib/types.ts";

/** Invalid evidence fails the grade without publishing a partial benchmark archive. */
export async function gradeEvidence(
  source: string,
  ctx: Pick<GradeContext, "taskDir">,
): Promise<{ check: GradeCheck; artifacts: string[] }> {
  const name = "build evidence can be archived with validated judge inputs";
  let artifacts: string[] = [];
  try {
    await publishFiles(new BuildWorkspace(ctx.taskDir), {
      prefix: ".build-record-",
      stage: async (pending) => {
        const kept = await keepBuildRecord(source, pending, {
          allowedRoot: ctx.taskDir,
        });
        artifacts = kept.map((file) =>
          path.join(ctx.taskDir, path.relative(pending, file)),
        );
        return ["judge", "journal.jsonl"];
      },
    });
    return { check: { name, pass: true, detail: source }, artifacts };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      check: { name, pass: false, detail: reason.slice(0, 300) },
      artifacts: [],
    };
  }
}
