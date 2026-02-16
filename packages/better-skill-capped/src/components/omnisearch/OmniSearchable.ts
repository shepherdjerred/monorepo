import { Commentary } from "../../model/Commentary";
import { Course } from "../../model/Course";
import { Video } from "../../model/Video";

type OmniSearchable = Video | Course | Commentary;

export default OmniSearchable;

export const searchableFields = [
  "title",
  "description",
  "alternateTitle",
  "videos.video.title",
  "videos.video.altTitle",
  "video.title",
  "video.description",
  "video.alternateTitle",
];
