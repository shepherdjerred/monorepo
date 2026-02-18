import { z } from "zod";
import type { WatchStatusDatastore } from "./watch-status-datastore.ts";
import type { WatchStatus } from "#src/model/watch-status";

const IDENTIFIER = "watchStatus";

const StoredWatchStatusSchema = z.custom<WatchStatus>((val) => {
  return typeof val === "object" && val !== null && "item" in val && "isWatched" in val;
});
const StoredWatchStatusesSchema = z.array(StoredWatchStatusSchema);

export class LocalStorageWatchStatusDatastore implements WatchStatusDatastore {
  add(watchStatus: WatchStatus): void {
    const existingWatchStatuses = this.get();
    existingWatchStatuses.push(watchStatus);
    this.set(existingWatchStatuses);
  }

  get(): WatchStatus[] {
    const raw: unknown = JSON.parse(
      globalThis.localStorage.getItem(IDENTIFIER) ?? "[]",
    );
    return StoredWatchStatusesSchema.parse(raw);
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
