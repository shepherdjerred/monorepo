import type { Video, Course, Commentary } from "./content.ts";

export type Bookmark = {
  item: Bookmarkable;
  date: Date;
};

export type Bookmarkable = Video | Course | Commentary;
