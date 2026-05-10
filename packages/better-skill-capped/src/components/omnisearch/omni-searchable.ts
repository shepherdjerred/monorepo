import type { Commentary } from "#src/model/commentary";
import type { Course } from "#src/model/course";
import type { Video } from "#src/model/video";

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
