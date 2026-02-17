import type { Video } from "./video";
import type { Course } from "./course";
import type { Commentary } from "./commentary";

export type Bookmark = {
  item: Bookmarkable;
  date: Date;
}

export type Bookmarkable = Video | Course | Commentary;
