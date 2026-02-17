import type { Video } from "./video";
import type { Course } from "./course";
import type { Commentary } from "./commentary";

export type Content = {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
}
