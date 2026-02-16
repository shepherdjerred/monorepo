import type { Commentary } from "@shepherdjerred/better-skill-capped/model/Commentary";
import type { Course } from "@shepherdjerred/better-skill-capped/model/Course";
import type { Video } from "@shepherdjerred/better-skill-capped/model/Video";

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
