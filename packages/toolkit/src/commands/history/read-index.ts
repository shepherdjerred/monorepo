import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";

/** Runs `callback` against the daemon's index, opened read-only. */
export async function withReadOnlyIndex<T>(
  callback: (index: HistoryIndex) => Promise<T> | T,
): Promise<T> {
  const index = await HistoryIndex.open(
    defaultHistoryRuntimePaths(),
    true,
  ).catch((error: unknown) => {
    throw new Error(
      `History index is not available. Run 'toolkit history daemon install' and wait for its first scan. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  try {
    return await callback(index);
  } finally {
    index.close();
  }
}
