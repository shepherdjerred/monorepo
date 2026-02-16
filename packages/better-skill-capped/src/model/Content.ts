import { Video } from "./Video";
import { Course } from "./Course";
import { Commentary } from "./Commentary";

export interface Content {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
}
