import path from "node:path";
import { z } from "zod";
import { mediaDownloadPolicy } from "homelab/src/media-download-policy.ts";

export const HashSchema = z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/iu);
export const TorrentSchema = z.object({
  hash: HashSchema,
  category: z.string(),
  content_path: z.string(),
  save_path: z.string(),
  download_path: z.string().optional(),
});
export type MediaTorrent = z.infer<typeof TorrentSchema>;
export const TorrentFileSchema = z.object({ name: z.string().min(1) });
export const HistorySchema = z.object({
  id: z.number().int().positive(),
  downloadId: z.string().nullish(),
  sourceTitle: z.string(),
  eventType: z.string(),
  seriesId: z.number().optional(),
  movieId: z.number().optional(),
});
export type MediaHistory = z.infer<typeof HistorySchema>;
export const QueueSchema = z.object({
  id: z.number().int(),
  downloadId: z.string().nullish(),
});
export const BlocklistSchema = z.object({
  sourceTitle: z.string(),
  seriesId: z.number().optional(),
  movieId: z.number().optional(),
});
export const IndexerSchema = z.looseObject({
  id: z.number().int().positive(),
  fields: z.array(
    z.looseObject({ name: z.string(), value: z.unknown().optional() }),
  ),
});

export function sameHash(left: string | null | undefined, right: string) {
  return left?.toLowerCase() === right.toLowerCase();
}

function inDownloadRoot(value: string) {
  return (
    value.startsWith(`${mediaDownloadPolicy.downloadRoot}/`) &&
    path.posix.normalize(value) === value &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

export function assertRemovalPaths(
  torrent: MediaTorrent,
  files: z.infer<typeof TorrentFileSchema>[],
) {
  if (
    !inDownloadRoot(torrent.content_path) ||
    !inDownloadRoot(`${torrent.save_path.replace(/\/$/u, "")}/placeholder`)
  ) {
    throw new Error("Unsafe media torrent removal path");
  }
  if (
    torrent.download_path !== undefined &&
    torrent.download_path !== "" &&
    !inDownloadRoot(`${torrent.download_path.replace(/\/$/u, "")}/placeholder`)
  ) {
    throw new Error("Unsafe incomplete download path");
  }
  for (const file of files) {
    if (
      path.posix.isAbsolute(file.name) ||
      file.name.includes("\\") ||
      file.name.includes("\0") ||
      file.name.split("/").some((part) => part === ".." || part === ".")
    ) {
      throw new Error("Unsafe media torrent filename");
    }
  }
}

export function dangerousFiles(files: z.infer<typeof TorrentFileSchema>[]) {
  return files.filter(({ name }) =>
    name
      .split("/")
      .some((part) =>
        mediaDownloadPolicy.dangerousExtensions.some((extension) =>
          part.toLowerCase().endsWith(extension),
        ),
      ),
  );
}
