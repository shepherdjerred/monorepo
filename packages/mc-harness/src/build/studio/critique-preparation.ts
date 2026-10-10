import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BUILD_FILES,
  JudgeCritiqueRecordSchema,
  type JudgeRubric,
  type RenderSidecar,
} from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { buildArtifactPath } from "#build/storage/artifact-path.ts";
import { stagedFiles } from "#build/storage/evidence-publication.ts";
import { writeSidecar } from "#build/sidecar.ts";
import { readCritiqueRecord } from "./critique-record.ts";

const artifact = z
  .string()
  .refine(
    (file) =>
      !path.isAbsolute(file) &&
      path.normalize(file) === file &&
      (file.startsWith("judge/") || file.startsWith("renders/")),
  );
export const PreparedCritique = z.strictObject({
  record: artifact,
  verdict: JudgeCritiqueRecordSchema,
  files: z.record(artifact, z.string().regex(/^[a-f0-9]{64}$/u)),
});
type PreparationInput = {
  sidecar: RenderSidecar;
  visual: boolean;
  rubric: JudgeRubric;
};
const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Rebuild derived preparation metadata only from a complete, validated paid verdict. */
export async function prepareCritiqueBundle(
  pending: BuildWorkspace,
  input: PreparationInput,
  record?: string,
): Promise<void> {
  const candidates =
    record === undefined ? await stagedFiles(pending.dir) : [record];
  const records = candidates.filter(
    (file) =>
      path.dirname(file) === BUILD_FILES.judgeDir && file.endsWith(".json"),
  );
  const [file] = records;
  if (file === undefined || records.length !== 1)
    throw new Error(
      `incomplete critique preparation at ${pending.dir}: expected one completed verdict`,
    );
  const bytes = await Bun.file(await buildArtifactPath(pending, file)).bytes();
  const verdict = JudgeCritiqueRecordSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  const stamp = verdict.at.replaceAll(/[:.]/gu, "-");
  if (path.basename(file) !== `critique-${stamp}-${checksum(bytes)}.json`)
    throw new Error(
      "prepared critique verdict checksum does not match its filename",
    );
  if (
    verdict.render !== input.sidecar.name ||
    verdict.gridHash !== input.sidecar.gridHash ||
    verdict.iteration !== input.sidecar.iteration ||
    verdict.rubric !== input.rubric
  )
    throw new Error("prepared critique does not match its inputs");
  await readCritiqueRecord(pending, {
    kind: "critique",
    at: verdict.at,
    iteration: verdict.iteration,
    render: verdict.render,
    gridHash: verdict.gridHash,
    rubric: verdict.rubric,
    file,
    total: verdict.total,
    max: verdict.max,
    lowest: verdict.lowest,
  });
  const artifacts = [file, verdict.sheet, verdict.grid];
  if (input.visual) {
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
    artifacts.push(
      path.join(BUILD_FILES.rendersDir, `${input.sidecar.name}.json`),
    );
  }
  const files: Record<string, string> = {};
  for (const item of artifacts)
    files[item] = checksum(
      await Bun.file(await buildArtifactPath(pending, item)).bytes(),
    );
  const temporary = pending.file(".prepared.pending");
  await Bun.write(
    temporary,
    `${JSON.stringify(PreparedCritique.parse({ record: file, verdict, files }))}\n`,
  );
  await rename(temporary, pending.file("prepared.json"));
}
