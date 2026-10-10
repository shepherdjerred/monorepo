import { buildArtifactPath } from "#build/storage/artifact-path.ts";
import path from "node:path";
import { createHash } from "node:crypto";
import { JudgePairRecordSchema, type BuildLogEntry } from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { readOutcomeScore } from "./score-evidence.ts";

/** Bind an immutable tournament image to its candidate and exact bytes. */
async function validateInput(
  workspace: BuildWorkspace,
  file: string,
  candidate: string,
) {
  const bytes = await Bun.file(
    await buildArtifactPath(workspace, file),
  ).bytes();
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (path.basename(file) !== `candidate-${candidate}-${hash}.png`) {
    throw new Error(`pair image ${file} does not match candidate ${candidate}`);
  }
}

/** A tournament outcome counts only with its matching verdict and both inputs. */
export async function readPairRecord(
  workspace: BuildWorkspace,
  entry: Extract<BuildLogEntry, { kind: "accept" | "reject" }>,
) {
  await readOutcomeScore(workspace, entry);
  if (entry.file === null) {
    if (entry.kind === "accept" && entry.versus === null) return null;
    throw new Error("paired outcomes require a verdict file");
  }
  const record = JudgePairRecordSchema.parse(
    await Bun.file(await buildArtifactPath(workspace, entry.file)).json(),
  );
  if (
    record.rubric !== entry.rubric ||
    entry.versus === null ||
    entry.candidate === entry.versus
  ) {
    throw new Error(
      `pair record ${entry.file} does not match its journal entry`,
    );
  }
  // A tie keeps the first (incumbent), matching the tournament writer.
  const kept = record.winner === "b" ? record.b : record.a;
  const dropped = record.winner === "b" ? record.a : record.b;
  const keptHash = record.winner === "b" ? record.grids?.b : record.grids?.a;
  const droppedHash = record.winner === "b" ? record.grids?.a : record.grids?.b;
  if (
    entry.gridHash !== undefined &&
    entry.gridHash !== (entry.kind === "accept" ? keptHash : droppedHash)
  )
    throw new Error("pair grid does not match outcome score evidence");
  await validateInput(
    workspace,
    entry.kind === "accept" ? kept : dropped,
    entry.candidate,
  );
  await validateInput(
    workspace,
    entry.kind === "accept" ? dropped : kept,
    entry.versus,
  );
  return record;
}
