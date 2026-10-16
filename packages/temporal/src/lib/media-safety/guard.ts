import { z } from "zod";
import { mediaDownloadPolicy } from "homelab/src/media-download-policy.ts";
import { MediaApi, loginQbittorrent, type MediaRequest } from "./client.ts";
import {
  assertRemovalPaths,
  dangerousFiles,
  TorrentFileSchema,
  TorrentSchema,
} from "./contracts.ts";
import {
  failOwnedTorrent,
  reconcileIndexerSafety,
  torrentHistory,
} from "./arr.ts";

export type MediaSafetyCredentials = {
  sonarr: string;
  radarr: string;
  username: string;
  password: string;
};
type AppName = keyof typeof mediaDownloadPolicy.applications;

async function torrentFiles(qbt: MediaApi, hash: string) {
  return z
    .array(TorrentFileSchema)
    .parse(await qbt.json(`torrents/files?hash=${hash}`));
}

async function removeRejectedTorrent(
  qbt: MediaApi,
  hash: string,
  category: string,
) {
  const remaining = z
    .array(TorrentSchema)
    .parse(await qbt.json(`torrents/info?hashes=${hash}`));
  if (remaining.length === 0) return;
  const [torrent] = remaining;
  if (
    torrent === undefined ||
    remaining.length !== 1 ||
    torrent.hash.toLowerCase() !== hash ||
    torrent.category !== category
  ) {
    throw new Error("Media torrent changed before removal");
  }
  const files = await torrentFiles(qbt, hash);
  assertRemovalPaths(torrent, files);
  if (dangerousFiles(files).length === 0)
    throw new Error("Dangerous metadata changed before removal");
  await qbt.form("torrents/delete", { hashes: hash, deleteFiles: "true" });
  const after = z
    .array(TorrentSchema)
    .parse(await qbt.json(`torrents/info?hashes=${hash}`));
  if (after.length > 0)
    throw new Error("Rejected media torrent removal was not observed");
}

export async function runMediaSafety(
  credentials: MediaSafetyCredentials,
  enforce: boolean,
  request: MediaRequest = fetch,
) {
  const qbt = await loginQbittorrent(
    mediaDownloadPolicy.qbittorrentUrl,
    credentials.username,
    credentials.password,
    request,
  );
  const torrents = z
    .array(TorrentSchema)
    .parse(await qbt.json("torrents/info"));
  const candidates: { app: AppName; hash: string; files: string[] }[] = [];
  const removed: Record<AppName, number> = { sonarr: 0, radarr: 0 };
  for (const app of ["sonarr", "radarr"] as const) {
    const settings = mediaDownloadPolicy.applications[app];
    const api = new MediaApi(
      `${settings.url}/api/v3`,
      { "X-Api-Key": credentials[app] },
      request,
    );
    for (const torrent of torrents.filter(
      ({ category }) => category === settings.category,
    )) {
      const hash = torrent.hash.toLowerCase();
      const files = await torrentFiles(qbt, hash);
      if (files.length === 0) continue; // Magnet metadata has not arrived yet.
      const dangerous = dangerousFiles(files);
      if (dangerous.length === 0) continue;
      assertRemovalPaths(torrent, files);
      const history = await torrentHistory(api, hash);
      if (!history.some(({ eventType }) => eventType === "grabbed")) continue;
      candidates.push({ app, hash, files: dangerous.map(({ name }) => name) });
      if (!enforce) continue;
      await qbt.form("torrents/stop", { hashes: hash });
      await failOwnedTorrent(api, hash, history);
      await removeRejectedTorrent(qbt, hash, settings.category);
      removed[app]++;
    }
  }
  // Inspect every application's content before availability-dependent saves.
  const indexersChanged = await reconcileApplications(
    credentials,
    enforce,
    request,
  );
  return { enforce, candidates, removed, indexersChanged };
}

async function reconcileApplications(
  credentials: MediaSafetyCredentials,
  enforce: boolean,
  request: MediaRequest,
) {
  let changed = 0;
  for (const app of ["sonarr", "radarr"] as const) {
    const api = new MediaApi(
      `${mediaDownloadPolicy.applications[app].url}/api/v3`,
      { "X-Api-Key": credentials[app] },
      request,
    );
    changed += await reconcileIndexerSafety(api, enforce);
  }
  return changed;
}
