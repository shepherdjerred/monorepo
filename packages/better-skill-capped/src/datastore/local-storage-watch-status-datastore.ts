import type { WatchStatusDatastore } from "./watch-status-datastore.ts";
import type { WatchStatus } from "#src/model/watch-status";

const IDENTIFIER = "watchStatus";

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
    if (!Array.isArray(raw)) {
      return [];
    }
    // eslint-disable-next-line custom-rules/no-type-assertions -- JSON.parse returns stored WatchStatus array
    return raw as WatchStatus[];
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
