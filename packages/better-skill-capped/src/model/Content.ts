import type { Video } from "./Video";
import type { Course } from "./Course";
import type { Commentary } from "./Commentary";

export type Content = {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
}
