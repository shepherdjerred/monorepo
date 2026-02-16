import type { WatchStatus } from "@shepherdjerred/better-skill-capped/model/WatchStatus";

export type WatchStatusDatastore = {
  add: (watchStatus: WatchStatus) => void;
  get: () => WatchStatus[];
  remove: (watchStatus: WatchStatus) => void;
}
