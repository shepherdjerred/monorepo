import type { WatchStatusDatastore } from "./WatchStatusDatastore";
import type { WatchStatus } from "@shepherdjerred/better-skill-capped/model/WatchStatus";

const IDENTIFIER = "watchStatus";

export class LocalStorageWatchStatusDatastore implements WatchStatusDatastore {
  add(watchStatus: WatchStatus): void {
    const existingWatchStatuses = this.get();
    existingWatchStatuses.push(watchStatus);
    this.set(existingWatchStatuses);
  }

  get(): WatchStatus[] {
    return JSON.parse(globalThis.localStorage.getItem(IDENTIFIER) ?? "[]") as WatchStatus[];
  }

  remove(watchStatus: WatchStatus): void {
    const filteredWatchStatuses = this.get().filter((candidate: WatchStatus) => {
      return candidate !== watchStatus && candidate.item.uuid !== watchStatus.item.uuid;
    });
    this.set(filteredWatchStatuses);
  }

  private set(watchStatuses: WatchStatus[]) {
    globalThis.localStorage.setItem(IDENTIFIER, JSON.stringify(watchStatuses));
  }
}
