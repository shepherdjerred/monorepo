import { z } from "zod";
import { mediaDownloadPolicy } from "homelab/src/media-download-policy.ts";
import {
  MediaApi,
  loginQbittorrent,
  mediaFailure,
  type MediaRequest,
} from "./client.ts";
import {
  assertRemovalPaths,
  dangerousFiles,
  TorrentFileSchema,
  TorrentSchema,
  type MediaTorrent,
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
const applications = ["sonarr", "radarr"] as const;
type Candidate = { app: AppName; hash: string; files: string[] };
type RemovalObserver = (application: AppName) => void;

async function torrentFiles(qbt: MediaApi, hash: string) {
  return z
    .array(TorrentFileSchema)
    .parse(await qbt.json(`torrents/files?hash=${hash}`));
}

async function removeRejectedTorrent(
  qbt: MediaApi,
  hash: string,
  category: string,
  onRemoved: () => void,
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
  onRemoved();
}

async function inspectTorrent(
  torrent: MediaTorrent,
  context: {
    app: AppName;
    qbt: MediaApi;
    api: MediaApi;
    enforce: boolean;
    onCandidate: (candidate: Candidate) => void;
    onRemoved: () => void;
  },
) {
  const { app, qbt, api, enforce } = context;
  const hash = torrent.hash.toLowerCase();
  const files = await torrentFiles(qbt, hash);
  if (files.length === 0) return; // Magnet metadata has not arrived yet.
  const dangerous = dangerousFiles(files);
  if (dangerous.length === 0) return;
  assertRemovalPaths(torrent, files);
  const history = await torrentHistory(api, hash);
  if (!history.some(({ eventType }) => eventType === "grabbed")) return;
  context.onCandidate({ app, hash, files: dangerous.map(({ name }) => name) });
  if (!enforce) return;
  await qbt.form("torrents/stop", { hashes: hash });
  await failOwnedTorrent(api, hash, history);
  await removeRejectedTorrent(
    qbt,
    hash,
    mediaDownloadPolicy.applications[app].category,
    context.onRemoved,
  );
}

async function inspectApplication(input: {
  app: AppName;
  key: string;
  qbt: MediaApi;
  torrents: MediaTorrent[];
  enforce: boolean;
  request: MediaRequest;
  onRemoval: RemovalObserver | undefined;
}) {
  const { app, qbt, enforce } = input;
  const settings = mediaDownloadPolicy.applications[app];
  const api = new MediaApi(
    `${settings.url}/api/v3`,
    { "X-Api-Key": input.key },
    input.request,
  );
  const candidates: Candidate[] = [];
  const failures: Error[] = [];
  let removed = 0;
  const context = {
    app,
    qbt,
    api,
    enforce,
    onCandidate: (candidate: Candidate) => {
      candidates.push(candidate);
    },
    onRemoved: () => {
      removed++;
      input.onRemoval?.(app);
    },
  };
  for (const torrent of input.torrents.filter(
    ({ category }) => category === settings.category,
  )) {
    try {
      await inspectTorrent(torrent, context);
    } catch (error) {
      failures.push(mediaFailure(`${app} torrent ${torrent.hash}`, error));
    }
  }
  return { app, candidates, removed, failures };
}

async function reconcileApplications(
  credentials: MediaSafetyCredentials,
  enforce: boolean,
  request: MediaRequest,
) {
  const results = await Promise.allSettled(
    applications.map(async (app) => {
      const api = new MediaApi(
        `${mediaDownloadPolicy.applications[app].url}/api/v3`,
        { "X-Api-Key": credentials[app] },
        request,
      );
      try {
        return await reconcileIndexerSafety(api, enforce);
      } catch (error) {
        throw mediaFailure(`${app} indexers`, error);
      }
    }),
  );
  let changed = 0;
  const failures: Error[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") changed += result.value;
    else failures.push(mediaFailure("Indexer reconciliation", result.reason));
  }
  return { changed, failures };
}

export async function runMediaSafety(
  credentials: MediaSafetyCredentials,
  enforce: boolean,
  request: MediaRequest = fetch,
  onRemoval?: RemovalObserver,
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
  if (
    new Set(torrents.map(({ hash }) => hash.toLowerCase())).size !==
    torrents.length
  )
    throw new Error("Duplicate media torrent hashes");
  // Each application progresses independently. A candidate failure is retained
  // for the final error while later candidates still receive their checks.
  const inspections = await Promise.allSettled(
    applications.map((app) =>
      inspectApplication({
        app,
        key: credentials[app],
        qbt,
        torrents,
        enforce,
        request,
        onRemoval,
      }),
    ),
  );
  const candidates: Candidate[] = [];
  const removed: Record<AppName, number> = { sonarr: 0, radarr: 0 };
  const failures: Error[] = [];
  for (const result of inspections) {
    if (result.status === "rejected") {
      failures.push(mediaFailure("Application inspection", result.reason));
      continue;
    }
    candidates.push(...result.value.candidates);
    removed[result.value.app] = result.value.removed;
    failures.push(...result.value.failures);
  }
  // Finish every application's content before availability-dependent saves.
  const settings = await reconcileApplications(credentials, enforce, request);
  failures.push(...settings.failures);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Media download safety scan failed: ${failures.map(({ message }) => message).join("; ")}`,
    );
  return { enforce, candidates, removed, indexersChanged: settings.changed };
}
