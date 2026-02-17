import type { Video } from "./video";
import type { Course } from "./course";
import type { Commentary } from "./commentary";

export type Watchable = Video | Course | Commentary;

export type WatchStatus = {
  item: Watchable;
  isWatched: boolean;
  lastUpdate: Date;
};
