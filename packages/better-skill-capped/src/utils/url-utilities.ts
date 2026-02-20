const BASE_URL = "https://www.skill-capped.com/lol/";
const BROWSE_URL = BASE_URL + "browse";

export function rawTitleToUrlTitle(rawTitle: string): string {
  return rawTitle
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("$", "")
    .replaceAll(/[!:.'%,[\]]/g, "");
}

export function getVideoUrl(video: { uuid: string }): string {
  return BROWSE_URL + "/video/" + video.uuid;
}

export function getCourseVideoUrl(
  video: { uuid: string },
  course: { uuid: string },
): string {
  return BROWSE_URL + "/course/" + video.uuid + "/" + course.uuid;
}

export function getCommentaryUrl(commentary: { uuid: string }): string {
  return BASE_URL + "commentaries/" + commentary.uuid;
}

export function getStreamUrl(video: { uuid: string }): string {
  return `https://www.skill-capped.com/lol/api/new/video/${video.uuid}/4500.m3u8`;
}
