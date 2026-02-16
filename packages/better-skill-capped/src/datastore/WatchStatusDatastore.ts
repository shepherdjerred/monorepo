import { WatchStatus } from "../model/WatchStatus";

export interface WatchStatusDatastore {
  add(watchStatus: WatchStatus): void;
  get(): WatchStatus[];
  remove(watchStatus: WatchStatus): void;
}
