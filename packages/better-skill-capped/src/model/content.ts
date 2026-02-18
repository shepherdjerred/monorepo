import type { Video } from "./video.ts";
import type { Course } from "./course.ts";
import type { Commentary } from "./commentary.ts";

export type Content = {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
};
