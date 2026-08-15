import type { Video, Course, Commentary } from "#src/model/content";

export type OmniSearchable = Video | Course | Commentary;

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
