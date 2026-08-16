import type { Video, Course, Commentary } from "./content.ts";

export type Watchable = Video | Course | Commentary;

export type WatchStatus = {
  item: Watchable;
  isWatched: boolean;
  lastUpdate: Date;
};
