import { stat } from "node:fs/promises";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import type { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";

/** Evidence only: actual owned original DB rows and their current native bytes.
 * No permission, accepted-quality update or synthetic physical identity. */
export async function nativeSeriesPackCaptionEvidenceV1(
  f: Pick<
    Awaited<ReturnType<typeof createPerEpisodeMultiSeasonFixture>>,
    "db" | "files" | "originalAssetIds"
  >,
) {
  const captions = await f.db.subtitleAsset.findMany({
    where: { assetId: { in: f.originalAssetIds } },
    orderBy: { id: "asc" },
    take: 49,
  });
  if (captions.length !== 48)
    throw new Error(
      `Actual native predecessor caption inventory is ${String(captions.length)}, expected48`,
    );
  const captionFiles = await Promise.all(
    captions.map(async (row) => {
      if (
        row.path === null ||
        row.storageKind !== "sidecar" ||
        row.state !== "installed"
      )
        throw new Error(
          `Actual original caption ${row.id} is not an installed native sidecar`,
        );
      const filename = workerFilePath(f.files, row.path);
      const current = await stat(filename, { bigint: true });
      if (!current.isFile())
        throw new Error(
          `Actual original caption ${row.id} is not a native file`,
        );
      return {
        id: row.id,
        path: row.path,
        sha256: await sha256File(filename),
        device: current.dev.toString(),
        inode: current.ino.toString(),
        sizeBytes: current.size.toString(),
      };
    }),
  );
  return { captions, captionFiles };
}
