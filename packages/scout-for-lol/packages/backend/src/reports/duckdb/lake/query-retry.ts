import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";

const LAKE_QUERY_SNAPSHOT_ATTEMPTS = 3;

function snapshotPaths(files: LakeFiles): string[] {
  return Object.values(files).flatMap((value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );
}

async function snapshotHasMissingFiles(files: LakeFiles): Promise<boolean> {
  const present = await Promise.all(
    snapshotPaths(files).map(async (file) => await Bun.file(file).exists()),
  );
  return present.includes(false);
}

type LakeResolver = (
  lakeDir: string,
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
) => Promise<LakeFiles>;

async function resolveQuerySnapshot(
  lakeDir: string,
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
  resolveFiles: LakeResolver,
): Promise<LakeFiles | undefined> {
  const buildBefore = await readCurrentBuildDir(lakeDir);
  let files: LakeFiles;
  try {
    files = await resolveFiles(lakeDir, capabilities);
  } catch (error) {
    const buildAfter = await readCurrentBuildDir(lakeDir);
    if (
      buildBefore !== buildAfter ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      return undefined;
    }
    throw error;
  }
  if (buildBefore !== (await readCurrentBuildDir(lakeDir))) return undefined;
  const missing = await snapshotHasMissingFiles(files);
  return missing ? undefined : files;
}

/**
 * Replay the whole read, including source resolution and SQL construction,
 * when CURRENT/build GC or staging cleanup removes a captured file. A query
 * that fails for any other reason is returned unchanged, and an exhausted
 * snapshot race is an error rather than a partial empty answer.
 */
export async function retryLakeQuery<T>(
  lakeDir: string,
  query: (files: LakeFiles) => Promise<T>,
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
  resolveFiles: LakeResolver,
): Promise<T> {
  for (let attempt = 0; attempt < LAKE_QUERY_SNAPSHOT_ATTEMPTS; attempt++) {
    const files = await resolveQuerySnapshot(
      lakeDir,
      capabilities,
      resolveFiles,
    );
    if (files === undefined) continue;
    try {
      return await query(files);
    } catch (error) {
      if (!(await snapshotHasMissingFiles(files))) throw error;
      if (attempt === LAKE_QUERY_SNAPSHOT_ATTEMPTS - 1) {
        throw new Error(
          `Report lake snapshot disappeared during ${LAKE_QUERY_SNAPSHOT_ATTEMPTS.toString()} query attempts`,
          { cause: error },
        );
      }
    }
  }
  throw new Error(
    `Report lake snapshot disappeared before ${LAKE_QUERY_SNAPSHOT_ATTEMPTS.toString()} query attempts`,
  );
}
