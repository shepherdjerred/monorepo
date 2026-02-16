import { Video } from "./Video";
import { Course } from "./Course";
import { Commentary } from "./Commentary";

export type Watchable = Video | Course | Commentary;

export interface WatchStatus {
  item: Watchable;
  isWatched: boolean;
  lastUpdate: Date;
}
