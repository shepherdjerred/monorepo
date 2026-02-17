import type { WatchStatus } from "#src/model/watch-status";

export type WatchStatusDatastore = {
  add: (watchStatus: WatchStatus) => void;
  get: () => WatchStatus[];
  remove: (watchStatus: WatchStatus) => void;
}
