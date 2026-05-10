import type { Video } from "./video.ts";
import type { Course } from "./course.ts";
import type { Commentary } from "./commentary.ts";

export type Watchable = Video | Course | Commentary;

export type WatchStatus = {
  item: Watchable;
  isWatched: boolean;
  lastUpdate: Date;
};
