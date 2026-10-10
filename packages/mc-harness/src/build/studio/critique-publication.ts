import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  BUILD_FILES,
  JudgeCritiqueRecordSchema,
  type RenderSidecar,
  type JudgeRubric,
} from "#protocol/build.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { writeJudgeRecord } from "#build/judge.ts";
import { writeSidecar, buildArtifactPath } from "#build/sidecar.ts";
import { publishFiles } from "#build/file-transaction.ts";
import {
  stagedFiles,
  stageJournal,
} from "#build/storage/evidence-publication.ts";
import { readCritiqueRecord } from "./critique-record.ts";

const artifact = z
  .string()
  .refine(
    (file) =>
      !path.isAbsolute(file) &&
      path.normalize(file) === file &&
      (file.startsWith("judge/") || file.startsWith("renders/")),
  );

const Prepared = z.strictObject({
  record: artifact,
  verdict: JudgeCritiqueRecordSchema,
  files: z.record(artifact, z.string().regex(/^[a-f0-9]{64}$/u)),
});
type Verdict = z.infer<typeof JudgeCritiqueRecordSchema>;

export function critiqueRequestKey(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function present(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Retain the completed paid result until all artifacts and its journal entry publish. */
export async function publishCritique(
  workspace: BuildWorkspace,
  input: {
    key: string;
    sidecar: RenderSidecar;
    visual: boolean;
    rubric: JudgeRubric;
  },
  prepare: (pending: BuildWorkspace) => Promise<Verdict>,
) {
  const dir = workspace.file(`.critique-${input.key}`);
  const pending = new BuildWorkspace(dir);
  const marker = pending.file("prepared.json");
  if (!(await present(dir))) {
    await mkdir(dir);
    let verdict: Verdict;
    try {
      verdict = JudgeCritiqueRecordSchema.parse(await prepare(pending));
    } catch (error) {
      await rm(dir, { recursive: true });
      throw error;
    }
    const recordFile = await writeJudgeRecord(dir, verdict);
    const record = path.relative(dir, recordFile);
    if (input.visual)
      await writeSidecar(pending, {
        ...input.sidecar,
        scores: {
          rubric: verdict.rubric,
          total: verdict.total,
          max: verdict.max,
          axes: verdict.axes,
          overallAesthetic: verdict.overallAesthetic,
        },
      });
    const files: Record<string, string> = {};
    for (const file of await stagedFiles(dir))
      files[file] = createHash("sha256")
        .update(await Bun.file(pending.file(file)).bytes())
        .digest("hex");
    await Bun.write(
      marker,
      `${JSON.stringify(Prepared.parse({ record, verdict, files }))}\n`,
    );
  }
  // An incomplete or damaged bundle fails loudly rather than paying again.
  const prepared = Prepared.parse(
    await Bun.file(
      await buildArtifactPath(workspace, path.relative(workspace.dir, marker)),
    ).json(),
  );
  for (const [file, expected] of Object.entries(prepared.files)) {
    const actual = createHash("sha256")
      .update(await Bun.file(await buildArtifactPath(pending, file)).bytes())
      .digest("hex");
    if (actual !== expected)
      throw new Error(
        `prepared critique artifact hash does not match: ${file}`,
      );
  }
  const { verdict, record } = prepared;
  if (
    verdict.render !== input.sidecar.name ||
    verdict.gridHash !== input.sidecar.gridHash ||
    verdict.iteration !== input.sidecar.iteration ||
    verdict.rubric !== input.rubric ||
    prepared.files[record] === undefined
  )
    throw new Error("prepared critique does not match its inputs");
  const validated = await readCritiqueRecord(pending, {
    kind: "critique",
    at: verdict.at,
    iteration: verdict.iteration,
    render: verdict.render,
    gridHash: verdict.gridHash,
    rubric: verdict.rubric,
    file: record,
    total: verdict.total,
    max: verdict.max,
    lowest: verdict.lowest,
  });
  if (!isDeepStrictEqual(validated, verdict))
    throw new Error("prepared critique record does not match its verdict");
  await publishFiles(workspace, {
    prefix: ".critique-publish-",
    stage: async (staged) => {
      const target = new BuildWorkspace(staged);
      for (const file of Object.keys(prepared.files)) {
        await mkdir(path.dirname(target.file(file)), { recursive: true });
        await copyFile(
          await buildArtifactPath(pending, file),
          target.file(file),
        );
      }
      await stageJournal(
        workspace,
        target,
        {
          kind: "critique",
          render: verdict.render,
          gridHash: verdict.gridHash,
          rubric: verdict.rubric,
          file: record,
          total: verdict.total,
          max: verdict.max,
          lowest: verdict.lowest,
        },
        { iteration: verdict.iteration },
      );
      return [...Object.keys(prepared.files), BUILD_FILES.journal];
    },
  });
  await rm(dir, { recursive: true });
  return { record, verdict };
}
