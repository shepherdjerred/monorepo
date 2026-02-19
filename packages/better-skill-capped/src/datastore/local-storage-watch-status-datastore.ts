import { z } from "zod";
import type { WatchStatusDatastore } from "./watch-status-datastore.ts";
import type { WatchStatus } from "#src/model/watch-status";

const IDENTIFIER = "watchStatus";

const StoredWatchStatusSchema: z.ZodType<WatchStatus> = z.looseObject({
  item: z.looseObject({ uuid: z.string() }),
  isWatched: z.boolean(),
  lastUpdate: z.unknown(),
}).pipe(z.custom<WatchStatus>());

function parseStoredWatchStatuses(json: string): WatchStatus[] {
  const raw: unknown = JSON.parse(json);
  const result = z.array(StoredWatchStatusSchema).safeParse(raw);
  if (!result.success) {
    return [];
  }
  return result.data;
}

export class LocalStorageWatchStatusDatastore implements WatchStatusDatastore {
  add(watchStatus: WatchStatus): void {
    const existingWatchStatuses = this.get();
    existingWatchStatuses.push(watchStatus);
    this.set(existingWatchStatuses);
  }

  get(): WatchStatus[] {
    return parseStoredWatchStatuses(
      globalThis.localStorage.getItem(IDENTIFIER) ?? "[]",
    );
  }

  remove(watchStatus: WatchStatus): void {
    const filteredWatchStatuses = this.get().filter(
      (candidate: WatchStatus) => {
        return (
          candidate !== watchStatus &&
          candidate.item.uuid !== watchStatus.item.uuid
        );
      },
    );
    this.set(filteredWatchStatuses);
  }

  private set(watchStatuses: WatchStatus[]) {
    globalThis.localStorage.setItem(IDENTIFIER, JSON.stringify(watchStatuses));
  }
}
