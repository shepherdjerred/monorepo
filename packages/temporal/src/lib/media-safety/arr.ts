import { z } from "zod";
import { mediaFailure, type MediaApi } from "./client.ts";
import {
  BlocklistSchema,
  HistorySchema,
  IndexerSchema,
  QueueSchema,
  sameHash,
  type MediaHistory,
} from "./contracts.ts";

async function reconcileIndexer(
  api: MediaApi,
  indexer: z.infer<typeof IndexerSchema>,
  enforce: boolean,
) {
  const field = indexer.fields.find(({ name }) => name === "failDownloads");
  if (field === undefined)
    throw new Error("Indexer lacks the required failDownloads contract");
  const configured = z.array(z.number().int()).parse(field.value);
  if (configured.includes(0) && configured.includes(1)) return 0;
  if (!enforce) return 1;
  const value = [...new Set([...configured, 0, 1])];
  // Normal saves test remote indexer availability. Allow the test to finish;
  // do not bypass it with forceSave.
  await api.send(
    `indexer/${String(indexer.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...indexer,
        fields: indexer.fields.map((entry) =>
          entry.name === "failDownloads" ? { ...entry, value } : entry,
        ),
      }),
    },
    60_000,
  );
  const confirmed = IndexerSchema.parse(
    await api.json(`indexer/${String(indexer.id)}`),
  );
  const result = z
    .array(z.number())
    .parse(
      confirmed.fields.find(({ name }) => name === "failDownloads")?.value,
    );
  if (!result.includes(0) || !result.includes(1))
    throw new Error("Indexer safety update was not observed");
  return 1;
}

export async function reconcileIndexerSafety(api: MediaApi, enforce: boolean) {
  const indexers = z.array(IndexerSchema).parse(await api.json("indexer"));
  const results = await Promise.allSettled(
    indexers.map(async (indexer) => {
      try {
        return await reconcileIndexer(api, indexer, enforce);
      } catch (error) {
        throw mediaFailure(`Indexer ${String(indexer.id)}`, error);
      }
    }),
  );
  let changed = 0;
  const failures: Error[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") changed += result.value;
    else failures.push(mediaFailure("Indexer update", result.reason));
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      failures.map(({ message }) => message).join("; "),
    );
  return changed;
}

export async function torrentHistory(api: MediaApi, hash: string) {
  const history = await api.pages(
    `history?downloadId=${hash.toUpperCase()}&sortKey=date&sortDirection=descending`,
    HistorySchema,
  );
  return history.filter((record) => sameHash(record.downloadId, hash));
}

export async function verifiedBlocklist(
  api: MediaApi,
  history: MediaHistory[],
) {
  const failed = history.filter(
    ({ eventType }) => eventType === "downloadFailed",
  );
  if (failed.length === 0) return false;
  const entries = await api.pages("blocklist", BlocklistSchema);
  return failed.some((failure) =>
    entries.some(
      (entry) =>
        entry.sourceTitle === failure.sourceTitle &&
        ((failure.seriesId !== undefined &&
          failure.seriesId === entry.seriesId) ||
          (failure.movieId !== undefined && failure.movieId === entry.movieId)),
    ),
  );
}

/** No blind retry: a timeout leaves the torrent stopped until a later read proves failure. */
export async function failOwnedTorrent(
  api: MediaApi,
  hash: string,
  history: MediaHistory[],
) {
  if (await verifiedBlocklist(api, history)) return;
  if (history.some(({ eventType }) => eventType === "downloadFailed")) {
    throw new Error(
      "Failed media history has no corresponding blocklist entry",
    );
  }
  const grabbed = history.find(({ eventType }) => eventType === "grabbed");
  if (grabbed === undefined)
    throw new Error("No grabbed history proves media torrent ownership");
  const queueEntries = await api.pages("queue", QueueSchema);
  const queue = queueEntries.find((entry) => sameHash(entry.downloadId, hash));
  if (queue === undefined) {
    await api.send(`history/failed/${String(grabbed.id)}`, { method: "POST" });
  } else {
    await api.send(
      `queue/${String(queue.id)}?removeFromClient=false&blocklist=true&skipRedownload=false`,
      { method: "DELETE" },
    );
  }
  if (!(await verifiedBlocklist(api, await torrentHistory(api, hash)))) {
    throw new Error("Media torrent failure and blocklist were not observed");
  }
}
