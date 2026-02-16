import type { Video } from "./Video";
import type { Course } from "./Course";
import type { Commentary } from "./Commentary";

export type Watchable = Video | Course | Commentary;

export type WatchStatus = {
  item: Watchable;
  isWatched: boolean;
  lastUpdate: Date;
}
