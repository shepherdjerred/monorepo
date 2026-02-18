import type { Video } from "./video.ts";
import type { Course } from "./course.ts";
import type { Commentary } from "./commentary.ts";

export type Bookmark = {
  item: Bookmarkable;
  date: Date;
};

export type Bookmarkable = Video | Course | Commentary;
