import { Video } from "./Video";
import { Course } from "./Course";
import { Commentary } from "./Commentary";

export interface Bookmark {
  item: Bookmarkable;
  date: Date;
}

export type Bookmarkable = Video | Course | Commentary;
