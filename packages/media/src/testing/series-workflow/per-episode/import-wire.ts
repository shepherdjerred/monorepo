import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import path from "node:path";
import type { PlexClient, PlexItem } from "#integrations/plex.ts";
import type { FileContext } from "#automation/files/types.ts";

export function configureImportPlex(
  plex: Pick<PlexClient, "sections" | "libraryPage" | "metadata">,
  items: PlexItem[],
  show: PlexItem,
) {
  plex.sections = () =>
    Promise.resolve([{ key: "2", type: "show", title: "Synthetic TV" }]);
  plex.libraryPage = () => Promise.resolve({ total: items.length, items });
  plex.metadata = (key) => {
    if (key === show.ratingKey) return Promise.resolve(show);
    const item = items.find((candidate) => candidate.ratingKey === key);
    if (item !== undefined) return Promise.resolve(item);
    const member = items.find((candidate) => candidate.parentRatingKey === key);
    if (member === undefined)
      throw new Error("Unexpected genuine import Plex route");
    return Promise.resolve({
      ratingKey: key,
      type: "season",
      title: `Season ${String(member.parentIndex)}`,
      index: member.parentIndex,
      parentRatingKey: show.ratingKey,
    });
  };
}

export function perEpisodePaths(
  files: FileContext,
): NonNullable<FileContext["pathMapping"]> {
  return {
    canonical: (kind, target, relative) =>
      target === "downloads"
        ? path.join("/downloads", relative)
        : path.join(
            `/data/${kind}`,
            target === "control" ? ".media-control" : "",
            relative,
          ),
    local: (stored) => {
      if (stored.startsWith("/downloads/"))
        return path.join(
          files.roots.tv.downloads,
          stored.slice("/downloads/".length),
        );
      for (const kind of ["movies", "tv"] as const)
        for (const target of ["control", "library"] as const) {
          const prefix =
            target === "control"
              ? `/data/${kind}/.media-control/`
              : `/data/${kind}/`;
          if (stored.startsWith(prefix))
            return path.join(
              files.roots[kind][target],
              stored.slice(prefix.length),
            );
        }
      return stored;
    },
  };
}

export async function verifyImportedEpisodes(
  db: Database,
  context: MediaAutomationContext,
  receipts: { receiptId: string; assets: { id: string }[] }[],
) {
  for (const receipt of receipts)
    for (const asset of receipt.assets) {
      const binding = await db.operation.findUniqueOrThrow({
        where: {
          idempotencyKey: `library-plex:${receipt.receiptId}:${asset.id}:0`,
        },
      });
      const verified = await verifyLibraryPlexBinding(
        context,
        LibraryPlexBindingInputV1Schema.parse(binding.payload),
        testPlexBindingExecution(),
      );
      if (verified.status !== "verified" || verified.bindingCount !== 1)
        throw new Error(
          `Actual imported per-episode binding failed: ${JSON.stringify(verified)}`,
        );
    }
}
