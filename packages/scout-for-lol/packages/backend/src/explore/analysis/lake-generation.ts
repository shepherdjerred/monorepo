import path from "node:path";
import { createHash } from "node:crypto";
import { readCurrentBuildDir, resolveLakeDir } from "#src/report-lake/paths.ts";
import { snapshotStagingGenerations } from "#src/report-lake/staging/generations.ts";

/** A dataset snapshot includes the selected staging generations, not only CURRENT. */
export async function captureAnalysisGeneration(lakeDir = resolveLakeDir()) {
  const buildDir = await readCurrentBuildDir(lakeDir);
  const staging = await snapshotStagingGenerations(lakeDir);
  if (buildDir !== (await readCurrentBuildDir(lakeDir)))
    throw new Error(
      "The lake changed while capturing its generation; retry the selection.",
    );
  const hash = createHash("sha256")
    .update(
      staging.selected
        .map((generation) => generation.generationId)
        .toSorted()
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    buildDir,
    staging,
    id: `${buildDir === undefined ? "staging-only" : path.basename(buildDir)}:${hash}`,
  };
}
