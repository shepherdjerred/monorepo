import type { Course } from "@shepherdjerred/better-skill-capped/model/Course";
import type { Video } from "@shepherdjerred/better-skill-capped/model/Video";
import type { Commentary } from "@shepherdjerred/better-skill-capped/model/Commentary";

const BASE_URL = "https://www.skill-capped.com/lol/";
const BROWSE_URL = BASE_URL + "browse";

export function rawTitleToUrlTitle(rawTitle: string): string {
  return rawTitle
    .toLowerCase()
    .replaceAll(' ', "-")
    .replaceAll('$', "")
    .replaceAll(/[!:.'%,[\]]/g, "");
}

export function getVideoUrl(video: Video): string {
  return BROWSE_URL + "/video/" + video.uuid;
}

export function getCourseVideoUrl(video: Video, course: Course): string {
  return BROWSE_URL + "/course/" + video.uuid + "/" + course.uuid;
}

export function getCommentaryUrl(commentary: Commentary): string {
  return BASE_URL + "commentaries/" + commentary.uuid;
}

export function getStreamUrl(video: Video | Commentary): string {
  return `https://www.skill-capped.com/lol/api/new/video/${video.uuid}/4500.m3u8`;
}
