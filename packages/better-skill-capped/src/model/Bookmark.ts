import type { Video } from "./Video";
import type { Course } from "./Course";
import type { Commentary } from "./Commentary";

export type Bookmark = {
  item: Bookmarkable;
  date: Date;
}

export type Bookmarkable = Video | Course | Commentary;
